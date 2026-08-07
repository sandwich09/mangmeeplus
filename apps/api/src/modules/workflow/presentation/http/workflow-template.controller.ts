import { Controller, Get, Post, Param, Body, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { RequirePermissions } from '../../../../common/security/permissions.decorator';
import { ReqCtx } from '../../../auth/presentation/request-context.decorator';
import type { RequestContext, EnableWorkflowTemplateInput } from '@watchdog-bms/contracts';
import { ListWorkflowTemplatesUseCase, EnableWorkflowTemplateUseCase } from '../../application/use-cases/workflow-template.use-case';

@ApiTags('workflow')
@Controller('companies/:companyId/workflow/templates')
export class WorkflowTemplateController {
  constructor(
    private readonly list: ListWorkflowTemplatesUseCase,
    private readonly enableTemplate: EnableWorkflowTemplateUseCase,
  ) {}

  @Get()
  @RequirePermissions('workflow.template.read')
  @ApiOperation({ summary: 'List workflow templates (available and unavailable)' })
  listTemplates(@ReqCtx() ctx: RequestContext) {
    return this.list.execute(ctx);
  }

  @Post(':templateKey/enable')
  @RequirePermissions('workflow.rule.manage', 'workflow.rule.enable')
  @HttpCode(200)
  @ApiOperation({ summary: 'Create a rule from a template (draft or enabled)' })
  enable(@ReqCtx() ctx: RequestContext, @Param('templateKey') templateKey: string, @Body() body: EnableWorkflowTemplateInput) {
    return this.enableTemplate.execute(ctx, templateKey, body ?? {});
  }
}
