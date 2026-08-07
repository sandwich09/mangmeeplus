import { ConflictException, Injectable, PayloadTooLargeException } from '@nestjs/common';
import type {
  ReportColumnDto,
  ReportChartKind,
  ReportDatasetDefinitionDto,
  ReportFilterValue,
  ReportResultDto,
  ReportSourceRefDto,
  RequestContext,
} from '@watchdog-bms/contracts';
import { GetGeneralLedgerUseCase, GetTrialBalanceUseCase, GetPnlReportUseCase, GetBalanceSheetUseCase } from '../../ledger/application/use-cases/report.use-case';
import { ListDocumentsUseCase } from '../../accounting-documents/application/use-cases/document.use-case';
import { GetStockReportUseCase, ListMovementsUseCase } from '../../inventory/application/use-cases/movement-query.use-cases';
import { ListExpensesUseCase } from '../../expenses/application/use-cases/expense-draft.use-case';
import { GetApAgingUseCase } from '../../procurement/application/use-cases/ap-reporting.use-case';
import { GetCashPositionUseCase } from '../../banking/application/use-cases/reconciliation.use-case';
import { GenerateSnapshotUseCase } from '../../dashboard-notifications/application/use-cases/generate-snapshot.use-case';
import { GetCrmDashboardSummaryUseCase } from '../../crm/application/use-cases/crm-ai.use-case';
import { GetTaxSummaryUseCase } from '../../tax/application/use-cases/get-tax-summary.use-case';
import { ListWorkflowRunsUseCase } from '../../workflow/application/use-cases/workflow-run.use-case';
import { ListWorkflowTasksUseCase } from '../../workflow/application/use-cases/workflow-task.use-case';
import { ListWorkflowRulesUseCase } from '../../workflow/application/use-cases/workflow-rule.use-case';
import { ListWorkflowDeadLettersUseCase } from '../../workflow/application/use-cases/workflow-dead-letter.use-case';
import { ListSuggestionsUseCase } from '../../ai-draft/application/use-cases/ai-suggestion-query.use-case';
import { REPORT_SYNC_EXPORT_MAX_ROWS } from '../domain/report-query-validator.logic';

type ValidatedQuery = {
  filters: Record<string, ReportFilterValue>;
  chartKind?: ReportChartKind;
  page: number;
  pageSize: number;
};

export type ReportAdapterResult = Omit<ReportResultDto, 'runId' | 'dataset'> & {
  /** Exact source authorities actually used to compute these rows; never returned by HTTP. */
  sourcePermissionsUsed?: string[];
};
type AdapterResult = ReportAdapterResult;

const SOURCE_PAGE_SIZE = 100;

const AVAILABLE_DATASETS = new Set([
  'financial.general_ledger',
  'financial.trial_balance',
  'financial.profit_and_loss',
  'financial.balance_sheet',
  'ar.aging',
  'ap.aging',
  'sales.summary',
  'sales.pipeline',
  'inventory.stock_balance',
  'inventory.stock_movement',
  'inventory.reorder',
  'expense.summary',
  'expense.accountant_evidence',
  'tax.summary',
  'bank.cash_position',
  'ops.workflow_sla',
  'ops.dashboard_health',
  'ai.suggestion_summary',
]);

function computedAt(): string {
  return new Date().toISOString();
}

function money(value: unknown): number {
  const parsed = Number(String(value ?? '0').replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function rowMoney(value: unknown): string {
  return money(value).toFixed(4);
}

function absMoney(value: unknown): number {
  return Math.abs(money(value));
}

function str(value: ReportFilterValue | undefined): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function periodKeyFromDate(value: ReportFilterValue | undefined): string {
  if (typeof value === 'string' && /^\d{4}-\d{2}/.test(value)) return value.slice(0, 7);
  return computedAt().slice(0, 7);
}

function iso(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return null;
}

function displayName(snapshot: unknown, fallback: string): string {
  if (snapshot && typeof snapshot === 'object') {
    const record = snapshot as Record<string, unknown>;
    if (typeof record.name === 'string') return record.name;
    if (typeof record.displayName === 'string') return record.displayName;
  }
  return fallback;
}

function paged<T>(rows: T[], page: number, pageSize: number): { rows: T[]; total: number } {
  const start = (page - 1) * pageSize;
  return { rows: rows.slice(start, start + pageSize), total: rows.length };
}

function assertReportRowLimit(count: number, maxRows = REPORT_SYNC_EXPORT_MAX_ROWS): void {
  if (count <= maxRows) return;
  throw new PayloadTooLargeException({
    code: 'export_too_large',
    message: 'รายงานมีมากกว่า 5,000 แถว กรุณาลดช่วงข้อมูลแล้วลองใหม่',
    maxRows,
  });
}

function sourceChanged(): never {
  throw new ConflictException({
    code: 'export_source_changed',
    message: 'ข้อมูลต้นทางเปลี่ยนระหว่างสร้างรายงาน กรุณาลองใหม่',
  });
}

async function foldSourceRows<T, A>(
  loadPage: (page: number, pageSize: number) => Promise<{ items: T[]; total: number }>,
  initial: A,
  fold: (accumulator: A, rows: T[]) => A,
  maxSourceRows?: number,
): Promise<A> {
  let accumulator = initial;
  let expectedTotal: number | undefined;
  let sourceRowCount = 0;
  const seenIds = new Set<string>();
  for (let page = 1; ; page += 1) {
    const result = await loadPage(page, SOURCE_PAGE_SIZE);
    if (expectedTotal === undefined) {
      expectedTotal = result.total;
      if (maxSourceRows !== undefined) assertReportRowLimit(expectedTotal, maxSourceRows);
    } else if (result.total !== expectedTotal) {
      sourceChanged();
    }

    for (const row of result.items) {
      const id = row && typeof row === 'object' && 'id' in row ? (row as { id?: unknown }).id : undefined;
      if (typeof id === 'string' && id.length > 0) {
        if (seenIds.has(id)) sourceChanged();
        seenIds.add(id);
      }
    }

    sourceRowCount += result.items.length;
    if (sourceRowCount > expectedTotal) sourceChanged();
    if (maxSourceRows !== undefined) assertReportRowLimit(sourceRowCount, maxSourceRows);
    accumulator = fold(accumulator, result.items);
    if (sourceRowCount === expectedTotal) return accumulator;
    if (result.items.length === 0) sourceChanged();
  }
}

async function collectSourceRows<T>(
  loadPage: (page: number, pageSize: number) => Promise<{ items: T[]; total: number }>,
  maxSourceRows?: number,
): Promise<T[]> {
  return foldSourceRows(loadPage, [] as T[], (rows, items) => {
    rows.push(...items);
    return rows;
  }, maxSourceRows);
}

function baseResult(definition: ReportDatasetDefinitionDto, query: ValidatedQuery, rows: AdapterResult['rows'], columns: ReportColumnDto[], extra: Partial<AdapterResult> = {}): AdapterResult {
  const asOf = computedAt();
  const page = paged(rows, query.page, query.pageSize);
  return {
    status: rows.length === 0 ? 'EMPTY' : 'READY',
    computedAt: asOf,
    freshness: { computedAt: asOf, sourceModules: [definition.sourceModule], freshnessStatus: 'fresh' },
    warnings: [],
    columns,
    rows: page.rows,
    sourceRefs: [],
    filters: query.filters,
    page: query.page,
    pageSize: query.pageSize,
    total: page.total,
    ...extra,
  };
}

function sourceRef(companyId: string, label: string, module: string, entityType: string, webPath: string, entityId?: string): ReportSourceRefDto {
  return { label, module, entityType, entityId, asOf: computedAt(), permissionChecked: true, webPath };
}

function chartFromRows(rows: AdapterResult['rows'], labelKey: string, valueKey: string, label: string, kind: NonNullable<ValidatedQuery['chartKind']>) {
  if (kind === 'table') return undefined;
  return {
    kind,
    labels: rows.slice(0, 12).map((row) => String(row[labelKey] ?? '')),
    series: [{ key: valueKey, label, values: rows.slice(0, 12).map((row) => Number(row[valueKey] ?? 0)) }],
  };
}

@Injectable()
export class ReportSourceAdapters {
  constructor(
    private readonly generalLedger: GetGeneralLedgerUseCase,
    private readonly trialBalance: GetTrialBalanceUseCase,
    private readonly pnl: GetPnlReportUseCase,
    private readonly balanceSheet: GetBalanceSheetUseCase,
    private readonly documents: ListDocumentsUseCase,
    private readonly stockReport: GetStockReportUseCase,
    private readonly movements: ListMovementsUseCase,
    private readonly expenses: ListExpensesUseCase,
    private readonly apAging: GetApAgingUseCase,
    private readonly cashPosition: GetCashPositionUseCase,
    private readonly dashboardSnapshot: GenerateSnapshotUseCase,
    private readonly crmSummary: GetCrmDashboardSummaryUseCase,
    private readonly taxSummary: GetTaxSummaryUseCase,
    private readonly workflowRuns: ListWorkflowRunsUseCase,
    private readonly workflowTasks: ListWorkflowTasksUseCase,
    private readonly workflowRules: ListWorkflowRulesUseCase,
    private readonly workflowDeadLetters: ListWorkflowDeadLettersUseCase,
    private readonly aiSuggestions: ListSuggestionsUseCase,
  ) {}

  isAvailable(code: string): boolean {
    return AVAILABLE_DATASETS.has(code);
  }

  executeForExport(ctx: RequestContext, definition: ReportDatasetDefinitionDto, query: ValidatedQuery): Promise<AdapterResult> {
    return this.execute(ctx, definition, { ...query, page: 1, pageSize: REPORT_SYNC_EXPORT_MAX_ROWS });
  }

  async execute(ctx: RequestContext, definition: ReportDatasetDefinitionDto, query: ValidatedQuery): Promise<AdapterResult> {
    if (!this.isAvailable(definition.code)) {
      return baseResult(definition, query, [], [], { status: 'UNAVAILABLE', warnings: ['source_query_port_not_ready'] });
    }

    switch (definition.code) {
      case 'financial.general_ledger':
        return this.generalLedgerReport(ctx, definition, query);
      case 'financial.trial_balance':
        return this.trialBalanceReport(ctx, definition, query);
      case 'financial.profit_and_loss':
        return this.pnlReport(ctx, definition, query);
      case 'financial.balance_sheet':
        return this.balanceSheetReport(ctx, definition, query);
      case 'ar.aging':
        return this.arAgingReport(ctx, definition, query);
      case 'ap.aging':
        return this.apAgingReport(ctx, definition, query);
      case 'sales.summary':
        return this.salesSummaryReport(ctx, definition, query);
      case 'sales.pipeline':
        return this.salesPipelineReport(ctx, definition, query);
      case 'inventory.stock_balance':
        return this.stockBalanceReport(ctx, definition, query);
      case 'inventory.stock_movement':
        return this.stockMovementReport(ctx, definition, query);
      case 'inventory.reorder':
        return this.reorderReport(ctx, definition, query);
      case 'expense.summary':
        return this.expenseSummaryReport(ctx, definition, query);
      case 'expense.accountant_evidence':
        return this.accountantEvidenceReport(ctx, definition, query);
      case 'tax.summary':
        return this.taxSummaryReport(ctx, definition, query);
      case 'bank.cash_position':
        return this.cashPositionReport(ctx, definition, query);
      case 'ops.workflow_sla':
        return this.workflowSlaReport(ctx, definition, query);
      case 'ops.dashboard_health':
        return this.dashboardHealthReport(ctx, definition, query);
      case 'ai.suggestion_summary':
        return this.aiSuggestionSummaryReport(ctx, definition, query);
      default:
        return baseResult(definition, query, [], [], { status: 'UNAVAILABLE', warnings: ['dataset_adapter_not_registered'] });
    }
  }

  private async generalLedgerReport(ctx: RequestContext, definition: ReportDatasetDefinitionDto, query: ValidatedQuery): Promise<AdapterResult> {
    const periodKey = str(query.filters.periodKey) ?? computedAt().slice(0, 7);
    const lines = await this.generalLedger.execute(ctx, periodKey);
    const rows = lines.map((line) => ({
      accountCode: line.accountCode,
      accountName: line.accountNameTh,
      totalDebit: line.totalDebit,
      totalCredit: line.totalCredit,
      endingBalance: line.endingBalance,
    }));
    return baseResult(definition, query, rows, [
      { key: 'accountCode', label: 'Account code', type: 'string' },
      { key: 'accountName', label: 'Account', type: 'string' },
      { key: 'totalDebit', label: 'Debit', type: 'money' },
      { key: 'totalCredit', label: 'Credit', type: 'money' },
      { key: 'endingBalance', label: 'Ending', type: 'money' },
    ], { sourceRefs: [sourceRef(ctx.companyId, `General Ledger ${periodKey}`, 'ledger', 'general_ledger', `/companies/${ctx.companyId}/reports`)] });
  }

  private async trialBalanceReport(ctx: RequestContext, definition: ReportDatasetDefinitionDto, query: ValidatedQuery): Promise<AdapterResult> {
    const periodKey = str(query.filters.periodKey) ?? computedAt().slice(0, 7);
    const tb = await this.trialBalance.execute(ctx, periodKey);
    const rows = tb.lines.map((line) => ({
      accountCode: line.accountCode,
      accountName: line.accountNameTh,
      accountClass: line.accountClass,
      totalDebit: line.totalDebit,
      totalCredit: line.totalCredit,
      balance: line.balance,
    }));
    return baseResult(definition, query, rows, [
      { key: 'accountCode', label: 'Account code', type: 'string' },
      { key: 'accountName', label: 'Account', type: 'string' },
      { key: 'accountClass', label: 'Class', type: 'string' },
      { key: 'totalDebit', label: 'Debit', type: 'money' },
      { key: 'totalCredit', label: 'Credit', type: 'money' },
      { key: 'balance', label: 'Balance', type: 'money' },
    ], {
      totals: { totalDebit: tb.totalDebit, totalCredit: tb.totalCredit, difference: tb.difference },
      chart: chartFromRows(rows, 'accountCode', 'balance', 'Balance', query.chartKind ?? 'table'),
      sourceRefs: [sourceRef(ctx.companyId, `Trial Balance ${periodKey}`, 'ledger', 'trial_balance', `/companies/${ctx.companyId}/reports`)],
    });
  }

  private async pnlReport(ctx: RequestContext, definition: ReportDatasetDefinitionDto, query: ValidatedQuery): Promise<AdapterResult> {
    const periodKey = str(query.filters.periodKey) ?? computedAt().slice(0, 7);
    const report = await this.pnl.execute(ctx, periodKey);
    const rows = report.sections.map((section) => ({ section: section.section, total: section.total }));
    return baseResult(definition, query, rows, [
      { key: 'section', label: 'Section', type: 'string' },
      { key: 'total', label: 'Total', type: 'money' },
    ], {
      totals: { revenue: report.revenue, grossProfit: report.grossProfit, netProfit: report.netProfit },
      chart: chartFromRows(rows, 'section', 'total', 'Total', query.chartKind ?? 'table'),
      sourceRefs: [sourceRef(ctx.companyId, `P&L ${periodKey}`, 'ledger', 'profit_and_loss', `/companies/${ctx.companyId}/reports`)],
    });
  }

  private async balanceSheetReport(ctx: RequestContext, definition: ReportDatasetDefinitionDto, query: ValidatedQuery): Promise<AdapterResult> {
    const periodKey = str(query.filters.periodKey) ?? computedAt().slice(0, 7);
    const report = await this.balanceSheet.execute(ctx, periodKey);
    const rows = report.sections.map((section) => ({ section: section.section, total: section.total }));
    return baseResult(definition, query, rows, [
      { key: 'section', label: 'Section', type: 'string' },
      { key: 'total', label: 'Total', type: 'money' },
    ], {
      totals: { totalAssets: report.totalAssets, totalLiabilities: report.totalLiabilities, totalEquity: report.totalEquity },
      chart: chartFromRows(rows, 'section', 'total', 'Total', query.chartKind ?? 'table'),
      sourceRefs: [sourceRef(ctx.companyId, `Balance Sheet ${periodKey}`, 'ledger', 'balance_sheet', `/companies/${ctx.companyId}/reports`)],
    });
  }

  private async arAgingReport(ctx: RequestContext, definition: ReportDatasetDefinitionDto, query: ValidatedQuery): Promise<AdapterResult> {
    const exportMode = query.pageSize === REPORT_SYNC_EXPORT_MAX_ROWS;
    const start = (query.page - 1) * query.pageSize;
    const end = start + query.pageSize;
    const detail = await foldSourceRows(async (page, pageSize) => {
      const result = await this.documents.execute(ctx, { documentType: 'INVOICE', page, pageSize });
      return { items: result.data, total: result.total };
    }, { rows: [] as AdapterResult['rows'], total: 0, outstanding: 0 }, (result, docs) => {
      for (const doc of docs) {
        if (money(doc.outstandingAmount) <= 0 || doc.status === 'VOIDED') continue;
        const outputIndex = result.total;
        result.total += 1;
        result.outstanding += money(doc.outstandingAmount);
        if (exportMode || (outputIndex >= start && outputIndex < end)) {
          result.rows.push({
            documentId: doc.id,
            documentNumber: doc.documentNumber ?? doc.id,
            counterpartyName: displayName(doc.counterpartySnapshotJson, 'Unknown customer'),
            documentDate: iso(doc.documentDate),
            dueDate: iso(doc.dueDate ?? doc.documentDate),
            outstandingAmount: doc.outstandingAmount,
            paymentStatus: doc.paymentStatus ?? 'UNPAID',
          });
        }
      }
      if (exportMode) assertReportRowLimit(result.total);
      return result;
    });
    const outstandingAmount = rowMoney(detail.outstanding);
    const reconciliation = await this.ledgerControlReconciliation(ctx, query, 'accounts_receivable', outstandingAmount);
    return baseResult(definition, { ...query, page: 1 }, detail.rows, [
      { key: 'documentNumber', label: 'Document', type: 'string' },
      { key: 'counterpartyName', label: 'Customer', type: 'string' },
      { key: 'documentDate', label: 'Document date', type: 'date' },
      { key: 'dueDate', label: 'Due date', type: 'date' },
      { key: 'outstandingAmount', label: 'Outstanding', type: 'money' },
      { key: 'paymentStatus', label: 'Payment', type: 'string' },
    ], {
      status: detail.total === 0 ? 'EMPTY' : 'READY',
      page: query.page,
      pageSize: query.pageSize,
      total: detail.total,
      totals: { outstandingAmount, ...reconciliation.totals },
      sourceRefs: [sourceRef(ctx.companyId, 'AR Aging', 'accounting-documents', 'ar_aging', `/companies/${ctx.companyId}/accounting`)],
      warnings: reconciliation.warnings,
      sourcePermissionsUsed: ['accounting.document.read', ...reconciliation.sourcePermissionsUsed],
    });
  }

  private async apAgingReport(ctx: RequestContext, definition: ReportDatasetDefinitionDto, query: ValidatedQuery): Promise<AdapterResult> {
    const aging = await this.apAging.execute(ctx, str(query.filters.asOfDate));
    const rows = aging.suppliers.map((supplier) => ({
      supplierId: supplier.supplierId,
      supplierDisplayName: supplier.supplierDisplayName,
      totalOutstanding: supplier.totalOutstanding,
      notDue: supplier.buckets[0]?.amount ?? '0',
      days0To30: supplier.buckets[1]?.amount ?? '0',
      days31To60: supplier.buckets[2]?.amount ?? '0',
      days61To90: supplier.buckets[3]?.amount ?? '0',
      days91Plus: supplier.buckets[4]?.amount ?? '0',
    }));
    const reconciliation = await this.ledgerControlReconciliation(ctx, query, 'accounts_payable', aging.totalOutstanding);
    return baseResult(definition, query, rows, [
      { key: 'supplierDisplayName', label: 'Supplier', type: 'string' },
      { key: 'totalOutstanding', label: 'Outstanding', type: 'money' },
      { key: 'notDue', label: 'Not due', type: 'money' },
      { key: 'days0To30', label: '0-30', type: 'money' },
      { key: 'days31To60', label: '31-60', type: 'money' },
      { key: 'days61To90', label: '61-90', type: 'money' },
      { key: 'days91Plus', label: '91+', type: 'money' },
    ], {
      totals: { totalOutstanding: aging.totalOutstanding, ...reconciliation.totals },
      sourceRefs: [sourceRef(ctx.companyId, 'AP Aging', 'procurement', 'ap_aging', `/companies/${ctx.companyId}/accounts-payable`)],
      warnings: reconciliation.warnings,
      sourcePermissionsUsed: ['procurement.ap.report', ...reconciliation.sourcePermissionsUsed],
    });
  }

  private async ledgerControlReconciliation(ctx: RequestContext, query: ValidatedQuery, reportGroup: 'accounts_receivable' | 'accounts_payable', sourceTotal: string): Promise<{ totals: Record<string, string | number | null>; warnings: string[]; sourcePermissionsUsed: string[] }> {
    if (!ctx.permissions.includes('ledger.report.read')) return { totals: {}, warnings: ['ledger_control_permission_missing'], sourcePermissionsUsed: [] };
    if (absMoney(sourceTotal) < 0.005) return { totals: {}, warnings: [], sourcePermissionsUsed: [] };
    const periodKey = periodKeyFromDate(query.filters.asOfDate);
    const tb = await this.trialBalance.execute(ctx, periodKey);
    const lines = tb.lines.filter((line) => line.reportGroup === reportGroup);
    if (lines.length === 0) return { totals: { ledgerControlPeriodKey: periodKey }, warnings: ['ledger_control_account_not_found_or_unposted'], sourcePermissionsUsed: ['ledger.report.read'] };

    const ledgerControlAmount = lines.reduce((sum, line) => sum + money(line.balance), 0);
    const difference = money(sourceTotal) - ledgerControlAmount;
    return {
      totals: {
        ledgerControlAmount: rowMoney(ledgerControlAmount),
        ledgerControlDifference: rowMoney(difference),
        ledgerControlPeriodKey: periodKey,
        ledgerControlAccountCodes: lines.map((line) => line.accountCode).join(', '),
      },
      warnings: Math.abs(difference) >= 0.005 ? ['ledger_control_mismatch'] : [],
      sourcePermissionsUsed: ['ledger.report.read'],
    };
  }

  private async salesSummaryReport(ctx: RequestContext, definition: ReportDatasetDefinitionDto, query: ValidatedQuery): Promise<AdapterResult> {
    const rows: AdapterResult['rows'] = [];
    const warnings: string[] = [];
    const sourcePermissionsUsed: string[] = [];
    if (ctx.permissions.includes('accounting.document.read')) {
      sourcePermissionsUsed.push('accounting.document.read');
      const invoices = await foldSourceRows(async (page, pageSize) => {
        const result = await this.documents.execute(ctx, { documentType: 'INVOICE', status: 'ISSUED', fromDate: str(query.filters.fromDate), toDate: str(query.filters.toDate), page, pageSize });
        return { items: result.data, total: result.total };
      }, { count: 0, amount: 0 }, (totals, docs) => {
        for (const doc of docs) {
          totals.count += 1;
          totals.amount += money(doc.grandTotalAmount);
        }
        return totals;
      });
      rows.push({
        source: 'issued_invoices',
        count: invoices.count,
        amount: rowMoney(invoices.amount),
      });
    } else {
      warnings.push('accounting_documents_scope_forbidden');
    }
    if (ctx.permissions.includes('crm.report.read')) {
      sourcePermissionsUsed.push('crm.report.read');
      const crm = await this.crmSummary.execute(ctx, 'all');
      rows.push({ source: 'crm_open_pipeline', count: crm.pipelineOpenCount, amount: crm.pipelineTotalAmount });
    } else {
      warnings.push('crm_scope_forbidden');
    }
    return baseResult(definition, query, rows, [
      { key: 'source', label: 'Source', type: 'string' },
      { key: 'count', label: 'Count', type: 'number' },
      { key: 'amount', label: 'Amount', type: 'money' },
    ], {
      status: rows.length > 0 && warnings.length > 0 ? 'PARTIAL' : rows.length === 0 ? 'FORBIDDEN' : 'READY',
      warnings,
      sourcePermissionsUsed,
      chart: chartFromRows(rows, 'source', 'amount', 'Amount', query.chartKind ?? 'table'),
      sourceRefs: [sourceRef(ctx.companyId, 'Sales Summary', 'reports', 'sales_summary', `/companies/${ctx.companyId}/reports`)],
    });
  }

  private async salesPipelineReport(ctx: RequestContext, definition: ReportDatasetDefinitionDto, query: ValidatedQuery): Promise<AdapterResult> {
    const crm = await this.crmSummary.execute(ctx, str(query.filters.scope) === 'own' ? 'own' : 'all');
    const rows = [
      { metric: 'open_pipeline_count', value: crm.pipelineOpenCount },
      { metric: 'pipeline_total_amount', value: crm.pipelineTotalAmount },
      { metric: 'followups_due_today', value: crm.followUpsDueToday },
      { metric: 'followups_overdue', value: crm.followUpsOverdue },
      { metric: 'stuck_opportunities', value: crm.stuckOpportunities },
    ];
    return baseResult(definition, query, rows, [
      { key: 'metric', label: 'Metric', type: 'string' },
      { key: 'value', label: 'Value', type: 'number' },
    ], {
      chart: chartFromRows(rows, 'metric', 'value', 'Value', query.chartKind ?? 'table'),
      sourceRefs: [sourceRef(ctx.companyId, 'CRM Pipeline', 'crm', 'pipeline_summary', `/companies/${ctx.companyId}/crm`)],
    });
  }

  private async stockBalanceReport(ctx: RequestContext, definition: ReportDatasetDefinitionDto, query: ValidatedQuery): Promise<AdapterResult> {
    const report = await this.stockReport.execute(ctx, { productId: str(query.filters.productId), locationId: str(query.filters.locationId) });
    const rows = report.items.map((item) => ({
      productId: item.productId,
      locationId: item.locationId,
      quantity: item.quantity,
      isLowStock: item.isLowStock ?? false,
    }));
    return baseResult(definition, query, rows, [
      { key: 'productId', label: 'Product', type: 'string' },
      { key: 'locationId', label: 'Location', type: 'string' },
      { key: 'quantity', label: 'Quantity', type: 'number' },
      { key: 'isLowStock', label: 'Low stock', type: 'boolean' },
    ], {
      chart: chartFromRows(rows, 'productId', 'quantity', 'Quantity', query.chartKind ?? 'table'),
      sourceRefs: [sourceRef(ctx.companyId, 'Stock Balance', 'inventory', 'stock_balance', `/companies/${ctx.companyId}/inventory`)],
      warnings: ['inventory_valuation_not_available'],
    });
  }

  private async stockMovementReport(ctx: RequestContext, definition: ReportDatasetDefinitionDto, query: ValidatedQuery): Promise<AdapterResult> {
    const filter = { fromDate: str(query.filters.fromDate), toDate: str(query.filters.toDate) };
    const sourcePage = query.pageSize === REPORT_SYNC_EXPORT_MAX_ROWS
      ? undefined
      : await this.movements.execute(ctx, { ...filter, page: query.page, pageSize: query.pageSize });
    const movements = sourcePage?.items ?? await collectSourceRows(
      (page, pageSize) => this.movements.execute(ctx, { ...filter, page, pageSize }),
      REPORT_SYNC_EXPORT_MAX_ROWS,
    );
    const rows = movements.map((movement) => ({
      movementNumber: movement.movementNumber ?? movement.id,
      productId: movement.productId,
      locationId: movement.locationId,
      movementType: movement.movementType,
      direction: movement.direction,
      quantity: movement.quantity,
      occurredAt: iso(movement.occurredAt),
    }));
    return baseResult(definition, sourcePage ? { ...query, page: 1 } : query, rows, [
      { key: 'movementNumber', label: 'Movement', type: 'string' },
      { key: 'productId', label: 'Product', type: 'string' },
      { key: 'locationId', label: 'Location', type: 'string' },
      { key: 'movementType', label: 'Type', type: 'string' },
      { key: 'direction', label: 'Direction', type: 'string' },
      { key: 'quantity', label: 'Quantity', type: 'number' },
      { key: 'occurredAt', label: 'Occurred', type: 'datetime' },
    ], {
      status: (sourcePage?.total ?? rows.length) === 0 ? 'EMPTY' : 'READY',
      page: query.page,
      pageSize: query.pageSize,
      total: sourcePage?.total ?? rows.length,
      sourceRefs: [sourceRef(ctx.companyId, 'Stock Movement', 'inventory', 'stock_movement', `/companies/${ctx.companyId}/inventory/reports/stock`)],
    });
  }

  private async reorderReport(ctx: RequestContext, definition: ReportDatasetDefinitionDto, query: ValidatedQuery): Promise<AdapterResult> {
    const report = await this.stockReport.execute(ctx, { lowStockOnly: true });
    const rows = report.items.map((item) => ({ productId: item.productId, locationId: item.locationId, quantity: item.quantity }));
    return baseResult(definition, query, rows, [
      { key: 'productId', label: 'Product', type: 'string' },
      { key: 'locationId', label: 'Location', type: 'string' },
      { key: 'quantity', label: 'Quantity', type: 'number' },
    ], {
      chart: chartFromRows(rows, 'productId', 'quantity', 'Quantity', query.chartKind ?? 'table'),
      sourceRefs: [sourceRef(ctx.companyId, 'Reorder Risk', 'inventory', 'reorder_report', `/companies/${ctx.companyId}/inventory`)],
    });
  }

  private async expenseSummaryReport(ctx: RequestContext, definition: ReportDatasetDefinitionDto, query: ValidatedQuery): Promise<AdapterResult> {
    const expenseAuthority = ctx.permissions.includes('expense.read')
      ? 'expense.read'
      : ctx.permissions.includes('expense.review')
        ? 'expense.review'
        : 'expense.read_own';
    const byStatus = await foldSourceRows(async (page, pageSize) => {
      const result = await this.expenses.execute(ctx, { fromDate: str(query.filters.fromDate), toDate: str(query.filters.toDate), page, pageSize });
      return { items: result.data, total: result.total };
    }, new Map<string, { count: number; total: number; paid: number; unpaid: number }>(), (totals, expenses) => {
      for (const expense of expenses) {
        const bucket = totals.get(expense.status) ?? { count: 0, total: 0, paid: 0, unpaid: 0 };
        bucket.count += 1;
        bucket.total += money(expense.grandTotalAmount);
        bucket.paid += money(expense.paidAmount);
        bucket.unpaid += money(expense.outstandingAmount);
        totals.set(expense.status, bucket);
      }
      return totals;
    });
    const rows = [...byStatus.entries()].map(([status, bucket]) => ({
      status,
      count: bucket.count,
      grandTotalAmount: bucket.total.toFixed(4),
      paidAmount: bucket.paid.toFixed(4),
      outstandingAmount: bucket.unpaid.toFixed(4),
    }));
    return baseResult(definition, query, rows, [
      { key: 'status', label: 'Status', type: 'string' },
      { key: 'count', label: 'Count', type: 'number' },
      { key: 'grandTotalAmount', label: 'Total', type: 'money' },
      { key: 'paidAmount', label: 'Paid', type: 'money' },
      { key: 'outstandingAmount', label: 'Outstanding', type: 'money' },
    ], {
      status: rows.length === 0 ? 'EMPTY' : expenseAuthority === 'expense.read_own' ? 'PARTIAL' : 'READY',
      warnings: expenseAuthority === 'expense.read_own' ? ['แสดงเฉพาะรายการค่าใช้จ่ายที่คุณสร้าง'] : [],
      chart: chartFromRows(rows, 'status', 'grandTotalAmount', 'Total', query.chartKind ?? 'table'),
      sourceRefs: [sourceRef(ctx.companyId, 'Expense Summary', 'expenses', 'expense_summary', `/companies/${ctx.companyId}/expenses`)],
      sourcePermissionsUsed: [expenseAuthority],
    });
  }

  private async accountantEvidenceReport(ctx: RequestContext, definition: ReportDatasetDefinitionDto, query: ValidatedQuery): Promise<AdapterResult> {
    const filter = { fromDate: str(query.filters.fromDate), toDate: str(query.filters.toDate) };
    const sourcePage = query.pageSize === REPORT_SYNC_EXPORT_MAX_ROWS
      ? undefined
      : await this.expenses.execute(ctx, { ...filter, page: query.page, pageSize: query.pageSize });
    const expenses = sourcePage?.data ?? await collectSourceRows(async (page, pageSize) => {
      const result = await this.expenses.execute(ctx, { ...filter, page, pageSize });
      return { items: result.data, total: result.total };
    }, REPORT_SYNC_EXPORT_MAX_ROWS);
    const rows = expenses.map((expense) => ({
      expenseNumber: expense.expenseNumber ?? expense.id,
      uploadedAt: iso(expense.uploadedAt ?? expense.createdAt),
      expenseDate: iso(expense.expenseDate),
      vendorName: expense.vendorNameSnapshot ?? '',
      sourceDocumentType: expense.sourceDocumentType ?? 'NEEDS_REVIEW',
      taxEvidenceStatus: expense.taxEvidenceStatus ?? 'NEEDS_REVIEW',
      // Spec §19h decision 4: an abbreviated tax invoice recorded before this change is
      // indistinguishable from a full-form one in stored data, so nothing is back-migrated.
      // These two columns are how an accountant finds the rows that actually claimed input VAT
      // (CONFIRMED + TAX_INVOICE + USABLE_FOR_TAX + CLAIMABLE) and checks them against the images.
      expenseStatus: expense.status,
      inputVatClaimStatus: expense.inputVatClaimStatus,
      category: expense.taxCategory ?? expense.accountHintKey ?? '',
      grandTotalAmount: expense.grandTotalAmount,
      vatAmount: expense.vatAmount,
      whtAmount: expense.whtAmount,
    }));
    return baseResult(definition, sourcePage ? { ...query, page: 1 } : query, rows, [
      { key: 'expenseNumber', label: 'Expense', type: 'string' },
      { key: 'uploadedAt', label: 'Uploaded', type: 'datetime' },
      { key: 'expenseDate', label: 'Document date', type: 'date' },
      { key: 'vendorName', label: 'Vendor', type: 'string' },
      { key: 'sourceDocumentType', label: 'Source type', type: 'string' },
      { key: 'taxEvidenceStatus', label: 'Tax evidence', type: 'string' },
      { key: 'expenseStatus', label: 'Status', type: 'string' },
      { key: 'inputVatClaimStatus', label: 'Input VAT claim', type: 'string' },
      { key: 'category', label: 'Category', type: 'string' },
      { key: 'grandTotalAmount', label: 'Total', type: 'money' },
      { key: 'vatAmount', label: 'VAT', type: 'money' },
      { key: 'whtAmount', label: 'WHT', type: 'money' },
    ], {
      status: (sourcePage?.total ?? rows.length) === 0 ? 'EMPTY' : 'READY',
      page: query.page,
      pageSize: query.pageSize,
      total: sourcePage?.total ?? rows.length,
      sourceRefs: [sourceRef(ctx.companyId, 'Accountant Evidence', 'expenses', 'accountant_evidence', `/companies/${ctx.companyId}/expenses`)],
    });
  }

  private async taxSummaryReport(ctx: RequestContext, definition: ReportDatasetDefinitionDto, query: ValidatedQuery): Promise<AdapterResult> {
    const periodKey = str(query.filters.periodKey) ?? computedAt().slice(0, 7);
    const summary = await this.taxSummary.execute(ctx, periodKey);
    const rows = summary.rows.map((row) => ({
      taxType: row.taxType,
      formType: row.formType,
      periodKey: row.periodKey,
      status: row.status,
      dueDate: row.dueDate,
      activeEventCount: row.activeEventCount,
      reviewIssueCount: row.reviewIssueCount,
      openIssueCount: row.openIssueCount,
      taxableBase: row.taxableBase,
      amount: row.taxAmount,
    }));
    return baseResult(definition, query, rows, [
      { key: 'taxType', label: 'Tax type', type: 'string' },
      { key: 'formType', label: 'Form', type: 'string' },
      { key: 'periodKey', label: 'Period', type: 'string' },
      { key: 'status', label: 'Status', type: 'string' },
      { key: 'dueDate', label: 'Due date', type: 'date' },
      { key: 'activeEventCount', label: 'Events', type: 'number' },
      { key: 'reviewIssueCount', label: 'Review issues', type: 'number' },
      { key: 'openIssueCount', label: 'Open issues', type: 'number' },
      { key: 'taxableBase', label: 'Taxable base', type: 'money' },
      { key: 'amount', label: 'Tax amount', type: 'money' },
    ], {
      totals: { amount: summary.totalTaxAmount, openIssueCount: summary.openIssueCount },
      chart: chartFromRows(rows, 'formType', 'amount', 'Tax amount', query.chartKind ?? 'table'),
      sourceRefs: [sourceRef(ctx.companyId, `Tax Summary ${periodKey}`, 'tax', 'tax_summary', `/companies/${ctx.companyId}/tax`)],
    });
  }

  private async cashPositionReport(ctx: RequestContext, definition: ReportDatasetDefinitionDto, query: ValidatedQuery): Promise<AdapterResult> {
    const rows = (await this.cashPosition.execute(ctx)).map((item) => ({
      bankAccountDisplayName: item.bankAccountDisplayName,
      currency: item.currency,
      lastReconciledDate: item.lastReconciledDate ?? null,
      lastReconciledBalance: item.lastReconciledBalance ?? null,
      unreconciledLineCount: item.unreconciledLineCount,
      unmatchedLineCount: item.unmatchedLineCount,
      pendingAdjustmentCount: item.pendingAdjustmentCount,
      lastStatementDate: item.lastStatementDate ?? null,
    }));
    return baseResult(definition, query, rows, [
      { key: 'bankAccountDisplayName', label: 'Bank account', type: 'string' },
      { key: 'currency', label: 'Currency', type: 'string' },
      { key: 'lastReconciledDate', label: 'Last reconciled', type: 'date' },
      { key: 'lastReconciledBalance', label: 'Last balance', type: 'money' },
      { key: 'unreconciledLineCount', label: 'Unreconciled', type: 'number' },
      { key: 'unmatchedLineCount', label: 'Unmatched', type: 'number' },
      { key: 'pendingAdjustmentCount', label: 'Pending adjustments', type: 'number' },
      { key: 'lastStatementDate', label: 'Last statement', type: 'date' },
    ], {
      chart: chartFromRows(rows, 'bankAccountDisplayName', 'unreconciledLineCount', 'Unreconciled', query.chartKind ?? 'table'),
      sourceRefs: [sourceRef(ctx.companyId, 'Cash Position', 'banking', 'cash_position', `/companies/${ctx.companyId}/banking`)],
    });
  }

  private async workflowSlaReport(ctx: RequestContext, definition: ReportDatasetDefinitionDto, query: ValidatedQuery): Promise<AdapterResult> {
    const rows: AdapterResult['rows'] = [];
    const warnings: string[] = [];
    const sourcePermissionsUsed: string[] = [];
    const from = str(query.filters.fromDate);
    const to = str(query.filters.toDate);

    if (ctx.permissions.includes('workflow.run.read')) {
      sourcePermissionsUsed.push('workflow.run.read');
      const [allRuns, failedRuns, partialRuns] = await Promise.all([
        this.workflowRuns.execute(ctx, { from, to, page: 1, pageSize: 1 }),
        this.workflowRuns.execute(ctx, { from, to, status: 'FAILED', page: 1, pageSize: 1 }),
        this.workflowRuns.execute(ctx, { from, to, status: 'PARTIAL_FAILED', page: 1, pageSize: 1 }),
      ]);
      rows.push(
        { metric: 'workflow_runs_total', value: allRuns.total, severity: 'info' },
        { metric: 'workflow_runs_failed', value: failedRuns.total, severity: failedRuns.total > 0 ? 'warning' : 'info' },
        { metric: 'workflow_runs_partial_failed', value: partialRuns.total, severity: partialRuns.total > 0 ? 'warning' : 'info' },
      );
    } else {
      warnings.push('workflow_run_scope_forbidden');
    }

    if (ctx.permissions.includes('workflow.task.read')) {
      sourcePermissionsUsed.push('workflow.task.read');
      const now = Date.now();
      const [openTasks, snoozedTasks] = await Promise.all([
        foldSourceRows(
          (page, pageSize) => this.workflowTasks.execute(ctx, { scope: 'all', status: 'OPEN', page, pageSize }),
          { count: 0, overdue: 0 },
          (totals, tasks) => {
            totals.count += tasks.length;
            totals.overdue += tasks.filter((task) => task.dueAt && new Date(task.dueAt).getTime() < now).length;
            return totals;
          },
        ),
        foldSourceRows(
          (page, pageSize) => this.workflowTasks.execute(ctx, { scope: 'all', status: 'SNOOZED', page, pageSize }),
          { count: 0, overdue: 0 },
          (totals, tasks) => {
            totals.count += tasks.length;
            totals.overdue += tasks.filter((task) => task.dueAt && new Date(task.dueAt).getTime() < now).length;
            return totals;
          },
        ),
      ]);
      const overdue = openTasks.overdue + snoozedTasks.overdue;
      rows.push(
        { metric: 'workflow_tasks_open', value: openTasks.count, severity: openTasks.count > 0 ? 'warning' : 'info' },
        { metric: 'workflow_tasks_snoozed', value: snoozedTasks.count, severity: snoozedTasks.count > 0 ? 'warning' : 'info' },
        { metric: 'workflow_tasks_overdue_visible', value: overdue, severity: overdue > 0 ? 'critical' : 'info' },
      );
    } else {
      warnings.push('workflow_task_scope_forbidden');
    }

    if (ctx.permissions.includes('workflow.rule.read')) {
      sourcePermissionsUsed.push('workflow.rule.read');
      const enabledRules = await this.workflowRules.execute(ctx, { status: 'ENABLED', page: 1, pageSize: 1 });
      rows.push({ metric: 'workflow_rules_enabled', value: enabledRules.total, severity: 'info' });
    } else {
      warnings.push('workflow_rule_scope_forbidden');
    }

    if (ctx.permissions.includes('workflow.dead_letter.read')) {
      sourcePermissionsUsed.push('workflow.dead_letter.read');
      const openDeadLetters = await this.workflowDeadLetters.execute(ctx, { resolutionStatus: 'OPEN', page: 1, pageSize: 1 });
      rows.push({ metric: 'workflow_dead_letters_open', value: openDeadLetters.total, severity: openDeadLetters.total > 0 ? 'critical' : 'info' });
    } else {
      warnings.push('workflow_dead_letter_scope_forbidden');
    }

    return baseResult(definition, query, rows, [
      { key: 'metric', label: 'Metric', type: 'string' },
      { key: 'value', label: 'Value', type: 'number' },
      { key: 'severity', label: 'Severity', type: 'string' },
    ], {
      status: warnings.length > 0 ? 'PARTIAL' : 'READY',
      warnings,
      chart: chartFromRows(rows, 'metric', 'value', 'Value', query.chartKind ?? 'table'),
      sourceRefs: [sourceRef(ctx.companyId, 'Workflow SLA', 'workflow', 'workflow_sla', `/companies/${ctx.companyId}/workflow`)],
      sourcePermissionsUsed,
    });
  }

  private async dashboardHealthReport(ctx: RequestContext, definition: ReportDatasetDefinitionDto, query: ValidatedQuery): Promise<AdapterResult> {
    const snapshot = await this.dashboardSnapshot.execute(ctx, ctx.companyId, { periodKind: 'today' });
    const sourcePermissionsUsed = new Set(['dashboard.read']);
    const rows = snapshot.widgets.flatMap((widget) => widget.metrics.flatMap((metric) => {
      const permissions = (metric.sourceRefs ?? [])
        .map((ref) => ref.permissionKey)
        .filter((permission): permission is string => typeof permission === 'string' && permission.length > 0);
      if (permissions.length === 0 || permissions.some((permission) => !ctx.permissions.includes(permission))) return [];
      permissions.forEach((permission) => sourcePermissionsUsed.add(permission));
      return [{
        metric: `${widget.title}: ${metric.label}`,
        value: metric.value,
        severity: metric.severity ?? 'info',
        freshnessStatus: snapshot.freshnessStatus,
      }];
    }));
    return baseResult(definition, query, rows, [
      { key: 'metric', label: 'Metric', type: 'string' },
      { key: 'value', label: 'Value', type: 'string' },
      { key: 'severity', label: 'Severity', type: 'string' },
      { key: 'freshnessStatus', label: 'Freshness', type: 'string' },
    ], {
      status: snapshot.freshnessStatus === 'fresh' ? (rows.length ? 'READY' : 'EMPTY') : 'STALE',
      freshness: {
        computedAt: snapshot.generatedAt,
        sourceModules: ['dashboard-notifications'],
        freshnessStatus: snapshot.freshnessStatus === 'fresh' ? 'fresh' : snapshot.freshnessStatus === 'stale' ? 'stale' : 'unknown',
        staleReason: snapshot.freshnessStatus === 'fresh' ? undefined : snapshot.freshnessStatus,
      },
      sourceRefs: [sourceRef(ctx.companyId, 'Dashboard Health', 'dashboard-notifications', 'dashboard_snapshot', `/companies/${ctx.companyId}/dashboard`, snapshot.id)],
      sourcePermissionsUsed: [...sourcePermissionsUsed],
    });
  }

  private async aiSuggestionSummaryReport(ctx: RequestContext, definition: ReportDatasetDefinitionDto, query: ValidatedQuery): Promise<AdapterResult> {
    const broad = ctx.permissions.includes('ai.suggestion.read');
    const scope = broad ? 'all' : 'own';
    const statuses = ['NEW', 'IN_REVIEW', 'BLOCKED_BY_PERMISSION', 'BLOCKED_BY_SOURCE_STATE', 'FAILED', 'SOURCE_DRAFT_CREATED', 'DISMISSED'] as const;
    const [all, highRisk, ...byStatus] = await Promise.all([
      foldSourceRows(
        (page, pageSize) => this.aiSuggestions.execute(ctx, { scope, page, pageSize }),
        { count: 0, needsData: 0 },
        (totals, suggestions) => {
          totals.count += suggestions.length;
          totals.needsData += suggestions.filter((item) => item.needsData).length;
          return totals;
        },
      ),
      this.aiSuggestions.execute(ctx, { scope, riskLevel: 'HIGH', page: 1, pageSize: 1 }),
      ...statuses.map((status) => this.aiSuggestions.execute(ctx, { scope, status, page: 1, pageSize: 1 })),
    ]);
    const rows = [
      { metric: 'ai_suggestions_total', value: all.count, severity: 'info' },
      { metric: 'ai_suggestions_high_risk', value: highRisk.total, severity: highRisk.total > 0 ? 'warning' : 'info' },
      { metric: 'ai_suggestions_needs_data_visible', value: all.needsData, severity: all.needsData > 0 ? 'warning' : 'info' },
      ...statuses.map((status, index) => ({
        metric: `ai_suggestions_${status.toLowerCase()}`,
        value: byStatus[index]?.total ?? 0,
        severity: ['BLOCKED_BY_PERMISSION', 'BLOCKED_BY_SOURCE_STATE', 'FAILED'].includes(status) && (byStatus[index]?.total ?? 0) > 0 ? 'warning' : 'info',
      })),
    ];
    return baseResult(definition, query, rows, [
      { key: 'metric', label: 'Metric', type: 'string' },
      { key: 'value', label: 'Value', type: 'number' },
      { key: 'severity', label: 'Severity', type: 'string' },
    ], {
      chart: chartFromRows(rows, 'metric', 'value', 'Value', query.chartKind ?? 'table'),
      sourceRefs: [sourceRef(ctx.companyId, 'AI Suggestion Summary', 'ai-draft', 'ai_suggestion_summary', `/companies/${ctx.companyId}/ai-suggestions`)],
      sourcePermissionsUsed: [broad ? 'ai.suggestion.read' : 'ai.suggestion.read_own'],
    });
  }
}
