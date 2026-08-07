import { Controller, Get, Post, Patch, Put, Param, Body, Query, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { RequirePermissions } from '../../../../common/security/permissions.decorator';
import { ReqCtx } from '../../../auth/presentation/request-context.decorator';
import type {
  RequestContext,
  CreateCrmOpportunityInput,
  UpdateCrmOpportunityInput,
  MoveCrmOpportunityStageInput,
  CloseCrmOpportunityInput,
  ReopenCrmOpportunityInput,
  ListCrmOpportunitiesFilter,
  UpdateCrmPipelineStagesInput,
  CreateCrmActivityInput,
  ListCrmActivitiesFilter,
  CreateCrmQuotationDraftInput,
  CrmOpportunityStatus,
} from '@watchdog-bms/contracts';
import {
  ListCrmPipelineStagesUseCase,
  UpdateCrmPipelineStagesUseCase,
  CreateCrmOpportunityUseCase,
  ListCrmOpportunitiesUseCase,
  GetCrmOpportunityUseCase,
  GetCrmPipelineBoardUseCase,
  UpdateCrmOpportunityUseCase,
  MoveCrmOpportunityStageUseCase,
  CloseCrmOpportunityUseCase,
  ReopenCrmOpportunityUseCase,
  ListCrmActivitiesUseCase,
  CreateCrmActivityUseCase,
} from '../../application/use-cases/crm-opportunity.use-case';
import {
  ListCrmQuotationLinksUseCase,
  CreateCrmQuotationDraftUseCase,
  RefreshCrmQuotationLinkUseCase,
} from '../../application/use-cases/crm-quotation.use-case';

@ApiTags('crm')
@Controller('companies/:companyId/crm')
export class CrmOpportunityController {
  constructor(
    private readonly listStages: ListCrmPipelineStagesUseCase,
    private readonly updateStages: UpdateCrmPipelineStagesUseCase,
    private readonly createOpportunity: CreateCrmOpportunityUseCase,
    private readonly listOpportunities: ListCrmOpportunitiesUseCase,
    private readonly getOpportunity: GetCrmOpportunityUseCase,
    private readonly board: GetCrmPipelineBoardUseCase,
    private readonly updateOpportunity: UpdateCrmOpportunityUseCase,
    private readonly moveStage: MoveCrmOpportunityStageUseCase,
    private readonly close: CloseCrmOpportunityUseCase,
    private readonly reopen: ReopenCrmOpportunityUseCase,
    private readonly listActivities: ListCrmActivitiesUseCase,
    private readonly createActivity: CreateCrmActivityUseCase,
    private readonly listQuotations: ListCrmQuotationLinksUseCase,
    private readonly createQuotation: CreateCrmQuotationDraftUseCase,
    private readonly refreshQuotation: RefreshCrmQuotationLinkUseCase,
  ) {}

  // ---- Pipeline stages ----

  @Get('pipeline/stages')
  @RequirePermissions('crm.opportunity.read')
  @ApiOperation({ summary: 'List pipeline stages' })
  stages(@ReqCtx() ctx: RequestContext) {
    return this.listStages.execute(ctx);
  }

  @Put('pipeline/stages')
  @RequirePermissions('crm.pipeline.configure')
  @ApiOperation({ summary: 'Configure pipeline stages' })
  configureStages(@ReqCtx() ctx: RequestContext, @Body() body: UpdateCrmPipelineStagesInput) {
    return this.updateStages.execute(ctx, body);
  }

  // ---- Activities ----

  @Get('activities')
  @RequirePermissions('crm.activity.read')
  @ApiOperation({ summary: 'List CRM activities' })
  activities(
    @ReqCtx() ctx: RequestContext,
    @Query('customerId') customerId?: string,
    @Query('opportunityId') opportunityId?: string,
    @Query('leadId') leadId?: string,
    @Query('actorUserId') actorUserId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const filter: ListCrmActivitiesFilter = { customerId, opportunityId, leadId, actorUserId, page: page ? Number(page) : undefined, pageSize: pageSize ? Number(pageSize) : undefined };
    return this.listActivities.execute(ctx, filter);
  }

  @Post('activities')
  @RequirePermissions('crm.activity.create')
  @ApiOperation({ summary: 'Append CRM activity' })
  addActivity(@ReqCtx() ctx: RequestContext, @Body() body: CreateCrmActivityInput) {
    return this.createActivity.execute(ctx, body);
  }

  // ---- Opportunities ----

  @Get('opportunities/board')
  @RequirePermissions('crm.opportunity.read')
  @ApiOperation({ summary: 'Pipeline board grouped by stage' })
  pipelineBoard(@ReqCtx() ctx: RequestContext, @Query('scope') scope?: 'own' | 'all') {
    return this.board.execute(ctx, scope);
  }

  @Get('opportunities')
  @RequirePermissions('crm.opportunity.read')
  @ApiOperation({ summary: 'List CRM opportunities' })
  list(
    @ReqCtx() ctx: RequestContext,
    @Query('scope') scope?: 'own' | 'all',
    @Query('status') status?: CrmOpportunityStatus,
    @Query('stageId') stageId?: string,
    @Query('customerId') customerId?: string,
    @Query('ownerUserId') ownerUserId?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const filter: ListCrmOpportunitiesFilter = { scope, status, stageId, customerId, ownerUserId, search, page: page ? Number(page) : undefined, pageSize: pageSize ? Number(pageSize) : undefined };
    return this.listOpportunities.execute(ctx, filter);
  }

  @Post('opportunities')
  @RequirePermissions('crm.opportunity.create')
  @ApiOperation({ summary: 'Create CRM opportunity' })
  create(@ReqCtx() ctx: RequestContext, @Body() body: CreateCrmOpportunityInput) {
    return this.createOpportunity.execute(ctx, body);
  }

  @Get('opportunities/:opportunityId')
  @RequirePermissions('crm.opportunity.read')
  @ApiOperation({ summary: 'Get CRM opportunity detail' })
  get(@ReqCtx() ctx: RequestContext, @Param('opportunityId') opportunityId: string) {
    return this.getOpportunity.execute(ctx, opportunityId);
  }

  @Patch('opportunities/:opportunityId')
  @RequirePermissions('crm.opportunity.update')
  @ApiOperation({ summary: 'Update CRM opportunity' })
  update(@ReqCtx() ctx: RequestContext, @Param('opportunityId') opportunityId: string, @Body() body: UpdateCrmOpportunityInput) {
    return this.updateOpportunity.execute(ctx, opportunityId, body);
  }

  @Post('opportunities/:opportunityId/stage')
  @RequirePermissions('crm.opportunity.stage_move')
  @HttpCode(200)
  @ApiOperation({ summary: 'Move opportunity stage' })
  move(@ReqCtx() ctx: RequestContext, @Param('opportunityId') opportunityId: string, @Body() body: MoveCrmOpportunityStageInput) {
    return this.moveStage.execute(ctx, opportunityId, body);
  }

  @Post('opportunities/:opportunityId/close')
  @RequirePermissions('crm.opportunity.close')
  @HttpCode(200)
  @ApiOperation({ summary: 'Close opportunity won/lost' })
  closeOpportunity(@ReqCtx() ctx: RequestContext, @Param('opportunityId') opportunityId: string, @Body() body: CloseCrmOpportunityInput) {
    return this.close.execute(ctx, opportunityId, body);
  }

  @Post('opportunities/:opportunityId/reopen')
  @RequirePermissions('crm.opportunity.reopen')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reopen terminal opportunity' })
  reopenOpportunity(@ReqCtx() ctx: RequestContext, @Param('opportunityId') opportunityId: string, @Body() body: ReopenCrmOpportunityInput) {
    return this.reopen.execute(ctx, opportunityId, body);
  }

  // ---- Quotation links ----

  @Get('opportunities/:opportunityId/quotations')
  @RequirePermissions('crm.opportunity.read')
  @ApiOperation({ summary: 'List opportunity quotation links' })
  quotations(@ReqCtx() ctx: RequestContext, @Param('opportunityId') opportunityId: string) {
    return this.listQuotations.execute(ctx, opportunityId);
  }

  @Post('opportunities/:opportunityId/quotation-drafts')
  @RequirePermissions('crm.quotation.link')
  @ApiOperation({ summary: 'Create/link a quotation draft (accounting item 08 boundary)' })
  createQuotationDraft(@ReqCtx() ctx: RequestContext, @Param('opportunityId') opportunityId: string, @Body() body: CreateCrmQuotationDraftInput) {
    return this.createQuotation.execute(ctx, opportunityId, body ?? {});
  }

  @Post('opportunities/:opportunityId/quotations/:linkId/refresh')
  @RequirePermissions('crm.opportunity.read')
  @HttpCode(200)
  @ApiOperation({ summary: 'Refresh quotation link status from accounting' })
  refresh(@ReqCtx() ctx: RequestContext, @Param('opportunityId') opportunityId: string, @Param('linkId') linkId: string) {
    return this.refreshQuotation.execute(ctx, opportunityId, linkId);
  }
}
