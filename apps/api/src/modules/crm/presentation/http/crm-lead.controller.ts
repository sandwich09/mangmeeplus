import { Controller, Get, Post, Patch, Param, Body, Query, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { RequirePermissions } from '../../../../common/security/permissions.decorator';
import { ReqCtx } from '../../../auth/presentation/request-context.decorator';
import type {
  RequestContext,
  CreateCrmLeadInput,
  UpdateCrmLeadInput,
  AssignCrmLeadInput,
  DisqualifyCrmLeadInput,
  ConvertCrmLeadInput,
  ListCrmLeadsFilter,
  CrmLeadStatus,
  CrmLeadSource,
} from '@watchdog-bms/contracts';
import {
  CreateCrmLeadUseCase,
  ListCrmLeadsUseCase,
  GetCrmLeadUseCase,
  UpdateCrmLeadUseCase,
  AssignCrmLeadUseCase,
  DisqualifyCrmLeadUseCase,
  ConvertCrmLeadUseCase,
} from '../../application/use-cases/crm-lead.use-case';

@ApiTags('crm')
@Controller('companies/:companyId/crm/leads')
export class CrmLeadController {
  constructor(
    private readonly createLead: CreateCrmLeadUseCase,
    private readonly listLeads: ListCrmLeadsUseCase,
    private readonly getLead: GetCrmLeadUseCase,
    private readonly updateLead: UpdateCrmLeadUseCase,
    private readonly assignLead: AssignCrmLeadUseCase,
    private readonly disqualifyLead: DisqualifyCrmLeadUseCase,
    private readonly convertLead: ConvertCrmLeadUseCase,
  ) {}

  @Get()
  @RequirePermissions('crm.lead.read')
  @ApiOperation({ summary: 'List CRM leads' })
  list(
    @ReqCtx() ctx: RequestContext,
    @Query('scope') scope?: 'own' | 'all',
    @Query('status') status?: CrmLeadStatus,
    @Query('source') source?: CrmLeadSource,
    @Query('assignedToUserId') assignedToUserId?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const filter: ListCrmLeadsFilter = { scope, status, source, assignedToUserId, search, page: page ? Number(page) : undefined, pageSize: pageSize ? Number(pageSize) : undefined };
    return this.listLeads.execute(ctx, filter);
  }

  @Post()
  @RequirePermissions('crm.lead.create')
  @ApiOperation({ summary: 'Create CRM lead' })
  create(@ReqCtx() ctx: RequestContext, @Body() body: CreateCrmLeadInput) {
    return this.createLead.execute(ctx, body);
  }

  @Get(':leadId')
  @RequirePermissions('crm.lead.read')
  @ApiOperation({ summary: 'Get CRM lead' })
  get(@ReqCtx() ctx: RequestContext, @Param('leadId') leadId: string) {
    return this.getLead.execute(ctx, leadId);
  }

  @Patch(':leadId')
  @RequirePermissions('crm.lead.update')
  @ApiOperation({ summary: 'Update CRM lead' })
  update(@ReqCtx() ctx: RequestContext, @Param('leadId') leadId: string, @Body() body: UpdateCrmLeadInput) {
    return this.updateLead.execute(ctx, leadId, body);
  }

  @Post(':leadId/assign')
  @RequirePermissions('crm.lead.assign')
  @HttpCode(200)
  @ApiOperation({ summary: 'Assign CRM lead' })
  assign(@ReqCtx() ctx: RequestContext, @Param('leadId') leadId: string, @Body() body: AssignCrmLeadInput) {
    return this.assignLead.execute(ctx, leadId, body);
  }

  @Post(':leadId/convert')
  @RequirePermissions('crm.lead.convert')
  @HttpCode(200)
  @ApiOperation({ summary: 'Convert CRM lead to customer/opportunity (idempotent)' })
  convert(@ReqCtx() ctx: RequestContext, @Param('leadId') leadId: string, @Body() body: ConvertCrmLeadInput) {
    return this.convertLead.execute(ctx, leadId, body);
  }

  @Post(':leadId/disqualify')
  @RequirePermissions('crm.lead.disqualify')
  @HttpCode(200)
  @ApiOperation({ summary: 'Disqualify CRM lead' })
  disqualify(@ReqCtx() ctx: RequestContext, @Param('leadId') leadId: string, @Body() body: DisqualifyCrmLeadInput) {
    return this.disqualifyLead.execute(ctx, leadId, body);
  }
}
