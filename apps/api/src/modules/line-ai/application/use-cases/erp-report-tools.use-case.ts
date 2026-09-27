import { Injectable } from '@nestjs/common';
import type { ReportFilterValue, ToolResult, SourceRef } from '@watchdog-bms/contracts';
import type { ErpReadToolPort, ErpToolContext } from '../../domain/ports/erp-read-tool.port';
import { RunReportQueryUseCase } from '../../../reports/application/report.use-cases';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import {
  BUSINESS_READ_BASIS_VERSION,
  appliedQuery,
  completeResult,
  fact,
  periodError,
  resolveBusinessReadPeriod,
  sourceRefId,
  type AppliedPeriod,
} from '../../domain/logic/business-read-source.logic';

function now(): string { return new Date().toISOString(); }

function toCtx(ctx: ErpToolContext): RequestContext {
  return {
    requestId: ctx.requestId ?? '',
    authSubject: ctx.userId,
    userId: ctx.userId,
    companyId: ctx.companyId,
    membershipId: ctx.membershipId ?? '',
    roles: [],
    permissions: ctx.permissions,
    scopes: { branchIds: ctx.branchIds, locationIds: ctx.locationIds },
    authProvider: 'watchdog',
  };
}

const REPORT_DATASETS = {
  operational_sales: 'sales.summary',
  posted_ledger: 'financial.profit_and_loss',
  operational_dashboard: 'ops.dashboard_health',
} as const;
type ReportDataset = keyof typeof REPORT_DATASETS;

@Injectable()
export class ReportsMonthlySummaryTool implements ErpReadToolPort {
  toolName = 'reports.get_monthly_report_summary';

  constructor(private readonly runReport: RunReportQueryUseCase) {}

  async execute(ctx: ErpToolContext, input: { dataset?: ReportDataset; periodKey?: string; fromDate?: string; toDate?: string } = {}): Promise<ToolResult> {
    let asOf = now();
    if (!ctx.permissions.includes('report.catalog.read') || !ctx.permissions.includes('report.dataset.read') || !ctx.permissions.includes('report.query.run')) {
      return { toolName: this.toolName, status: 'forbidden', sourceRefs: [], asOf };
    }

    if (!input.dataset || !(input.dataset in REPORT_DATASETS)) {
      return { toolName: this.toolName, status: 'error', sourceRefs: [], asOf, errorCode: 'DATASET_REQUIRED', errorMessage: 'dataset must be operational_sales, posted_ledger, or operational_dashboard' };
    }
    const datasetCode = REPORT_DATASETS[input.dataset];

    const filters: Record<string, ReportFilterValue> = {};
    let appliedPeriod: AppliedPeriod;
    if (input.dataset === 'operational_dashboard') {
      if (input.periodKey || input.fromDate || input.toDate) {
        return { toolName: this.toolName, status: 'error', sourceRefs: [], asOf, errorCode: 'UNSUPPORTED_FILTER', errorMessage: 'operational_dashboard does not support period filters' };
      }
      const resolved = resolveBusinessReadPeriod({});
      if (!resolved.ok) return periodError(this.toolName, asOf, resolved);
      appliedPeriod = resolved.period;
    } else {
      const resolved = resolveBusinessReadPeriod(input);
      if (!resolved.ok) return periodError(this.toolName, asOf, resolved);
      appliedPeriod = resolved.period;
      if (input.dataset === 'posted_ledger') {
        if (!appliedPeriod.periodKey) {
          return { toolName: this.toolName, status: 'error', sourceRefs: [], asOf, errorCode: 'UNSUPPORTED_FILTER', errorMessage: 'posted_ledger requires periodKey' };
        }
        filters.periodKey = appliedPeriod.periodKey;
      } else {
        filters.fromDate = appliedPeriod.fromDate;
        filters.toDate = appliedPeriod.toDate;
      }
    }

    const result = await this.runReport.execute(toCtx(ctx), ctx.companyId, { datasetCode, filters, chartKind: 'table', page: 1, pageSize: 20 });
    asOf = result.computedAt;
    const refs: SourceRef[] = [
      ...result.sourceRefs.map((ref) => ({
        label: ref.label,
        module: ref.module,
        entityType: ref.entityType,
        entityId: ref.entityId,
        asOf: ref.asOf,
        permissionChecked: true as const,
        webPath: ref.webPath,
      })),
      { label: result.dataset.title, module: 'reports', entityType: 'report_dataset', entityId: datasetCode, asOf, permissionChecked: true as const, webPath: `/companies/${ctx.companyId}/reports` },
    ];
    const queryApplied = appliedQuery(input.dataset === 'operational_dashboard' ? undefined : appliedPeriod, {
      dateBasis: input.dataset === 'posted_ledger' ? 'ledger_accounting_period' : input.dataset === 'operational_sales' ? 'source_document_date' : 'current_dashboard_snapshot',
      statusBasis: input.dataset === 'posted_ledger' ? 'posted_ledger_only' : input.dataset === 'operational_sales' ? 'dataset_definition' : 'current_operational_state',
      dataset: input.dataset,
    });
    const displayRows = result.rows.slice(0, 6);
    const completeness = completeResult(displayRows.length, result.total > displayRows.length, Object.keys(result.totals ?? {}).length, false);
    if (result.status !== 'READY') completeness.aggregate = result.status === 'PARTIAL' ? 'partial' : 'unknown';
    const numeric = (value: unknown): value is string | number =>
      (typeof value === 'string' || typeof value === 'number') && /^-?\d+(?:\.\d+)?$/.test(String(value));
    const facts = Object.entries(result.totals ?? {}).flatMap(([metric, value]) => {
      if (!numeric(value)) return [];
      // This tool selects exactly three approved datasets. Canonical P&L totals are money;
      // an absent currency stays explicit rather than being guessed as THB or relabelled a count.
      const type = input.dataset === 'posted_ledger' ? 'money' : result.columns.find(column => column.key === metric)?.type;
      if (type !== 'money' && type !== 'number') return [];
      return [fact({
        id: `report.${input.dataset}.${metric}`, metric, value: String(value), unit: type === 'money' ? 'money' : 'count', currency: null,
        period: queryApplied.period ?? null, dateBasis: queryApplied.dateBasis, statusBasis: queryApplied.statusBasis,
        sourceRefIds: refs.map(sourceRefId), asOf, state: 'known',
      })];
    });
    for (const [index, row] of displayRows.entries()) {
      for (const column of result.columns) {
        const value = row[column.key];
        if (!['money', 'number'].includes(column.type) || !numeric(value)) continue;
        const currentPipeline = input.dataset === 'operational_sales' && row.source === 'crm_open_pipeline';
        facts.push(fact({
          id: `report.${input.dataset}.row${index}.${column.key}`, metric: `${String(row.source ?? row.section ?? 'row')}.${column.key}`,
          value: String(value), unit: column.type === 'money' ? 'money' : 'count',
          currency: column.type === 'money' && typeof row.currency === 'string' && /^[A-Z]{3}$/.test(row.currency) ? row.currency : null,
          period: currentPipeline ? null : queryApplied.period ?? null,
          dateBasis: currentPipeline ? 'current_pipeline_snapshot' : queryApplied.dateBasis,
          statusBasis: currentPipeline ? 'open_pipeline' : queryApplied.statusBasis,
          sourceRefIds: refs.map(sourceRefId), asOf, state: 'known',
        }));
      }
    }
    const warnings = [...result.warnings, ...(facts.some(item => item.unit === 'money' && item.currency === null) ? ['source_currency_unavailable'] : [])];

    return {
      toolName: this.toolName,
      status: result.status === 'FORBIDDEN' ? 'forbidden'
        : result.status === 'UNAVAILABLE' ? 'unavailable'
          : ['INVALID_FILTER', 'FAILED'].includes(result.status) ? 'error' : 'ok',
      data: {
        datasetCode,
        title: result.dataset.title,
        status: result.status,
        totals: result.totals ?? {},
        warnings,
        rows: displayRows,
        webPath: `/companies/${ctx.companyId}/reports`,
        queryApplied,
        completeness,
      },
      sourceRefs: refs,
      asOf,
      stale: result.freshness.freshnessStatus === 'stale',
      queryApplied,
      basisVersion: BUSINESS_READ_BASIS_VERSION,
      facts,
      completeness,
    };
  }
}
