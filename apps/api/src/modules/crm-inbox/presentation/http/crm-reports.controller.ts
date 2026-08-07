import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { DashboardPeriodKind, RequestContext } from '@watchdog-bms/contracts';
import { RequirePermissions } from '../../../../common/security/permissions.decorator';
import { ReqCtx } from '../../../auth/presentation/request-context.decorator';
import { GetCrmReportsSummaryUseCase } from '../../application/use-cases/crm-reports-summary.use-case';

const REPORT_PERIODS: DashboardPeriodKind[] = ['today', 'week', 'month', 'quarter', 'last_month'];

@ApiTags('crm')
@Controller('companies/:companyId/crm/reports')
export class CrmReportsController {
  constructor(private readonly getSummary: GetCrmReportsSummaryUseCase) {}

  @Get('summary')
  @RequirePermissions('crm.report.read')
  @ApiOperation({ summary: 'CRM reports summary with real LTV aggregation' })
  @ApiQuery({ name: 'period', required: false, enum: REPORT_PERIODS, description: 'Date-scope for chat metrics (default today)' })
  summary(@ReqCtx() ctx: RequestContext, @Query('branchId') branchId?: string, @Query('period') period?: string) {
    const periodKind = REPORT_PERIODS.includes(period as DashboardPeriodKind) ? (period as DashboardPeriodKind) : 'today';
    return this.getSummary.execute(ctx, { branchId, period: periodKind });
  }
}
