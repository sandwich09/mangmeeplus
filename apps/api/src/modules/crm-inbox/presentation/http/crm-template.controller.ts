import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../../../common/security/permissions.decorator';
import { ReqCtx } from '../../../auth/presentation/request-context.decorator';
import type { RequestContext, CreateCrmMessageTemplateInput, UpdateCrmMessageTemplateInput } from '@watchdog-bms/contracts';
import {
  ListCrmMessageTemplatesUseCase,
  CreateCrmMessageTemplateUseCase,
  UpdateCrmMessageTemplateUseCase,
  ApproveCrmMessageTemplateForAiUseCase,
  ArchiveCrmMessageTemplateUseCase,
} from '../../application/use-cases/crm-template.use-case';

@ApiTags('crm-inbox')
@Controller('companies/:companyId/crm/templates')
export class CrmTemplateController {
  constructor(
    private readonly listTemplates: ListCrmMessageTemplatesUseCase,
    private readonly createTemplate: CreateCrmMessageTemplateUseCase,
    private readonly updateTemplate: UpdateCrmMessageTemplateUseCase,
    private readonly approveTemplateForAi: ApproveCrmMessageTemplateForAiUseCase,
    private readonly archiveTemplate: ArchiveCrmMessageTemplateUseCase,
  ) {}

  @Get()
  @RequirePermissions('crm.template.read')
  @ApiOperation({ summary: 'List CRM message templates (quick replies)' })
  async list(@ReqCtx() ctx: RequestContext, @Query('includeArchived') includeArchived?: string) {
    return this.listTemplates.execute(ctx, includeArchived === 'true');
  }

  @Post(':templateId/approve-ai')
  @RequirePermissions('crm.template.manage')
  @HttpCode(200)
  @ApiOperation({ summary: 'Approve the current CRM message template version for autonomous AI context' })
  async approveAi(@ReqCtx() ctx: RequestContext, @Param('templateId') templateId: string) {
    return this.approveTemplateForAi.execute(ctx, templateId);
  }

  @Post()
  @RequirePermissions('crm.template.manage')
  @ApiOperation({ summary: 'Create a CRM message template' })
  async create(@ReqCtx() ctx: RequestContext, @Body() body: CreateCrmMessageTemplateInput) {
    return this.createTemplate.execute(ctx, body);
  }

  @Post(':templateId')
  @RequirePermissions('crm.template.manage')
  @HttpCode(200)
  @ApiOperation({ summary: 'Update a CRM message template' })
  async update(
    @ReqCtx() ctx: RequestContext,
    @Param('templateId') templateId: string,
    @Body() body: UpdateCrmMessageTemplateInput,
  ) {
    return this.updateTemplate.execute(ctx, templateId, body);
  }

  @Post(':templateId/archive')
  @RequirePermissions('crm.template.manage')
  @HttpCode(200)
  @ApiOperation({ summary: 'Archive a CRM message template' })
  async archive(@ReqCtx() ctx: RequestContext, @Param('templateId') templateId: string) {
    return this.archiveTemplate.execute(ctx, templateId);
  }
}
