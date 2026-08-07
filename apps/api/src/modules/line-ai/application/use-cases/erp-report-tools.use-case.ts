import { Injectable } from '@nestjs/common';
import type { ReportFilterValue, ToolResult, SourceRef } from '@watchdog-bms/contracts';
import type { ErpReadToolPort, ErpToolContext } from '../../domain/ports/erp-read-tool.port';
import { RunReportQueryUseCase } from '../../../reports/application/report.use-cases';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';

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

function pickDataset(ctx: ErpToolContext): string | null {
  if (ctx.permissions.includes('ledger.report.read')) return 'financial.profit_and_loss';
  if (ctx.permissions.includes('accounting.document.read') || ctx.permissions.includes('crm.report.read')) return 'sales.summary';
  if (ctx.permissions.includes('dashboard.read')) return 'ops.dashboard_health';
  return null;
}

@Injectable()
export class ReportsMonthlySummaryTool implements ErpReadToolPort {
  toolName = 'reports.get_monthly_report_summary';

  constructor(private readonly runReport: RunReportQueryUseCase) {}

  async execute(ctx: ErpToolContext, input: { periodKey?: string; fromDate?: string; toDate?: string }): Promise<ToolResult> {
    const asOf = now();
    if (!ctx.permissions.includes('report.catalog.read') || !ctx.permissions.includes('report.dataset.read') || !ctx.permissions.includes('report.query.run')) {
      return { toolName: this.toolName, status: 'forbidden', sourceRefs: [], asOf };
    }

    const datasetCode = pickDataset(ctx);
    if (!datasetCode) return { toolName: this.toolName, status: 'forbidden', sourceRefs: [], asOf };

    const filters: Record<string, ReportFilterValue> = {};
    if (input.periodKey) filters.periodKey = input.periodKey;
    if (input.fromDate) filters.fromDate = input.fromDate;
    if (input.toDate) filters.toDate = input.toDate;

    const result = await this.runReport.execute(toCtx(ctx), ctx.companyId, { datasetCode, filters, chartKind: 'table', page: 1, pageSize: 20 });
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

    return {
      toolName: this.toolName,
      status: result.status === 'FORBIDDEN' ? 'forbidden' : result.status === 'UNAVAILABLE' ? 'unavailable' : 'ok',
      data: {
        datasetCode,
        title: result.dataset.title,
        status: result.status,
        totals: result.totals ?? {},
        warnings: result.warnings,
        rows: result.rows.slice(0, 6),
        webPath: `/companies/${ctx.companyId}/reports`,
      },
      sourceRefs: refs,
      asOf,
      stale: result.freshness.freshnessStatus === 'stale',
    };
  }
}
