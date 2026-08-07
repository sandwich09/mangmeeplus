import { Controller, Get, Post, Param, Query, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { RequirePermissions } from '../../../../common/security/permissions.decorator';
import { ReqCtx } from '../../../auth/presentation/request-context.decorator';
import type { RequestContext, ListWorkflowRunsFilter, WorkflowRunStatus } from '@watchdog-bms/contracts';
import { ListWorkflowRunsUseCase, GetWorkflowRunDetailUseCase, GetWorkflowExplanationUseCase, ReplayWorkflowActionRunUseCase } from '../../application/use-cases/workflow-run.use-case';

@ApiTags('workflow')
@Controller('companies/:companyId/workflow')
export class WorkflowRunController {
  constructor(
    private readonly list: ListWorkflowRunsUseCase,
    private readonly getDetail: GetWorkflowRunDetailUseCase,
    private readonly explain: GetWorkflowExplanationUseCase,
    private readonly replay: ReplayWorkflowActionRunUseCase,
  ) {}

  @Get('runs')
  @RequirePermissions('workflow.run.read')
  @ApiOperation({ summary: 'List workflow runs' })
  listRuns(
    @ReqCtx() ctx: RequestContext,
    @Query('ruleId') ruleId?: string,
    @Query('status') status?: WorkflowRunStatus,
    @Query('sourceModule') sourceModule?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const filter: ListWorkflowRunsFilter = {
      ruleId, status, sourceModule, from, to,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    };
    return this.list.execute(ctx, filter);
  }

  @Get('runs/:runId')
  @RequirePermissions('workflow.run.read')
  @ApiOperation({ summary: 'Get workflow run detail (rule version snapshot, condition result, action runs)' })
  getRun(@ReqCtx() ctx: RequestContext, @Param('runId') runId: string) {
    return this.getDetail.execute(ctx, runId);
  }

  @Get('explanations/:runId')
  @RequirePermissions('workflow.run.read')
  @ApiOperation({ summary: 'Human-readable explanation of why a run fired' })
  explainRun(@ReqCtx() ctx: RequestContext, @Param('runId') runId: string) {
    return this.explain.execute(ctx, runId);
  }

  @Post('action-runs/:actionRunId/replay')
  @RequirePermissions('workflow.run.replay')
  @HttpCode(200)
  @ApiOperation({ summary: 'Replay a failed workflow action run' })
  replayActionRun(@ReqCtx() ctx: RequestContext, @Param('actionRunId') actionRunId: string) {
    return this.replay.execute(ctx, actionRunId);
  }
}
