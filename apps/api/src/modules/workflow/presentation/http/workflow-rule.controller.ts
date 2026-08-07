import { Controller, Get, Post, Patch, Param, Body, Query, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { RequirePermissions } from '../../../../common/security/permissions.decorator';
import { ReqCtx } from '../../../auth/presentation/request-context.decorator';
import type {
  RequestContext,
  CreateWorkflowRuleInput,
  UpdateWorkflowRuleInput,
  ListWorkflowRulesFilter,
  WorkflowRuleStatus,
  WorkflowTriggerType,
} from '@watchdog-bms/contracts';
import {
  CreateWorkflowRuleUseCase,
  ListWorkflowRulesUseCase,
  GetWorkflowRuleUseCase,
  UpdateWorkflowRuleUseCase,
  EnableWorkflowRuleUseCase,
  DisableWorkflowRuleUseCase,
  TestWorkflowRuleUseCase,
} from '../../application/use-cases/workflow-rule.use-case';

@ApiTags('workflow')
@Controller('companies/:companyId/workflow/rules')
export class WorkflowRuleController {
  constructor(
    private readonly create: CreateWorkflowRuleUseCase,
    private readonly list: ListWorkflowRulesUseCase,
    private readonly getRule: GetWorkflowRuleUseCase,
    private readonly update: UpdateWorkflowRuleUseCase,
    private readonly enableRule: EnableWorkflowRuleUseCase,
    private readonly disableRule: DisableWorkflowRuleUseCase,
    private readonly testRule: TestWorkflowRuleUseCase,
  ) {}

  @Get()
  @RequirePermissions('workflow.rule.read')
  @ApiOperation({ summary: 'List workflow rules' })
  listRules(
    @ReqCtx() ctx: RequestContext,
    @Query('status') status?: WorkflowRuleStatus,
    @Query('triggerType') triggerType?: WorkflowTriggerType,
    @Query('sourceModule') sourceModule?: string,
    @Query('templateId') templateId?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const filter: ListWorkflowRulesFilter = {
      status, triggerType, sourceModule, templateId, search,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    };
    return this.list.execute(ctx, filter);
  }

  @Post()
  @RequirePermissions('workflow.rule.manage')
  @ApiOperation({ summary: 'Create a draft workflow rule' })
  createRule(@ReqCtx() ctx: RequestContext, @Body() body: CreateWorkflowRuleInput) {
    return this.create.execute(ctx, body);
  }

  @Get(':ruleId')
  @RequirePermissions('workflow.rule.read')
  @ApiOperation({ summary: 'Get workflow rule detail' })
  getOne(@ReqCtx() ctx: RequestContext, @Param('ruleId') ruleId: string) {
    return this.getRule.execute(ctx, ruleId);
  }

  @Patch(':ruleId')
  @RequirePermissions('workflow.rule.manage')
  @ApiOperation({ summary: 'Edit a draft/disabled workflow rule' })
  updateRule(@ReqCtx() ctx: RequestContext, @Param('ruleId') ruleId: string, @Body() body: UpdateWorkflowRuleInput) {
    return this.update.execute(ctx, ruleId, body);
  }

  @Post(':ruleId/enable')
  @RequirePermissions('workflow.rule.enable')
  @HttpCode(200)
  @ApiOperation({ summary: 'Enable a workflow rule (creates immutable version)' })
  enable(@ReqCtx() ctx: RequestContext, @Param('ruleId') ruleId: string) {
    return this.enableRule.execute(ctx, ruleId);
  }

  @Post(':ruleId/disable')
  @RequirePermissions('workflow.rule.manage')
  @HttpCode(200)
  @ApiOperation({ summary: 'Disable a workflow rule (stops future runs)' })
  disable(@ReqCtx() ctx: RequestContext, @Param('ruleId') ruleId: string) {
    return this.disableRule.execute(ctx, ruleId);
  }

  @Post(':ruleId/test')
  @RequirePermissions('workflow.rule.manage')
  @HttpCode(200)
  @ApiOperation({ summary: 'Evaluate condition/action plan against a sample payload (no side effects)' })
  test(@ReqCtx() ctx: RequestContext, @Param('ruleId') ruleId: string, @Body() body: { samplePayload?: Record<string, unknown> }) {
    return this.testRule.execute(ctx, ruleId, body?.samplePayload ?? {});
  }
}
