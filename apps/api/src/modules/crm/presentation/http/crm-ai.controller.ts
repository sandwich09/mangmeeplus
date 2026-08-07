import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { RequirePermissions } from '../../../../common/security/permissions.decorator';
import { ReqCtx } from '../../../auth/presentation/request-context.decorator';
import type { RequestContext } from '@watchdog-bms/contracts';
import {
  GetCrmFollowUpPrioritiesUseCase,
  GetCrmCustomerAiSummaryUseCase,
  GetCrmOpportunityAiSummaryUseCase,
  GetCrmPipelineAiSummaryUseCase,
  GetCrmDashboardSummaryUseCase,
} from '../../application/use-cases/crm-ai.use-case';

@ApiTags('crm')
@Controller('companies/:companyId/crm')
export class CrmAiController {
  constructor(
    private readonly followUpPriorities: GetCrmFollowUpPrioritiesUseCase,
    private readonly customerSummary: GetCrmCustomerAiSummaryUseCase,
    private readonly opportunitySummary: GetCrmOpportunityAiSummaryUseCase,
    private readonly pipelineSummary: GetCrmPipelineAiSummaryUseCase,
    private readonly dashboardSummary: GetCrmDashboardSummaryUseCase,
  ) {}

  @Get('dashboard/summary')
  @RequirePermissions('crm.report.read')
  @ApiOperation({ summary: 'CRM dashboard summary' })
  dashboard(@ReqCtx() ctx: RequestContext, @Query('scope') scope?: 'own' | 'all') {
    return this.dashboardSummary.execute(ctx, scope);
  }

  @Get('ai/follow-up-priorities')
  @RequirePermissions('crm.ai.read')
  @ApiOperation({ summary: 'Read-only follow-up priorities (source-backed)' })
  priorities(@ReqCtx() ctx: RequestContext, @Query('scope') scope?: 'own' | 'all') {
    return this.followUpPriorities.execute(ctx, scope);
  }

  @Get('ai/customers/:customerId/summary')
  @RequirePermissions('crm.ai.read')
  @ApiOperation({ summary: 'Read-only customer summary (source-backed)' })
  customer(@ReqCtx() ctx: RequestContext, @Param('customerId') customerId: string) {
    return this.customerSummary.execute(ctx, customerId);
  }

  @Get('ai/opportunities/:opportunityId/summary')
  @RequirePermissions('crm.ai.read')
  @ApiOperation({ summary: 'Read-only opportunity summary (source-backed)' })
  opportunity(@ReqCtx() ctx: RequestContext, @Param('opportunityId') opportunityId: string) {
    return this.opportunitySummary.execute(ctx, opportunityId);
  }

  @Get('ai/pipeline-summary')
  @RequirePermissions('crm.ai.read')
  @ApiOperation({ summary: 'Read-only pipeline summary (source-backed)' })
  pipeline(@ReqCtx() ctx: RequestContext, @Query('scope') scope?: 'own' | 'all') {
    return this.pipelineSummary.execute(ctx, scope);
  }
}
