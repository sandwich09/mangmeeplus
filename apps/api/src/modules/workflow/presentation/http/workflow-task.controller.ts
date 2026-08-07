import { Controller, Get, Post, Param, Body, Query, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { RequirePermissions } from '../../../../common/security/permissions.decorator';
import { ReqCtx } from '../../../auth/presentation/request-context.decorator';
import type { RequestContext, ListWorkflowTasksFilter, WorkflowTaskStatus, WorkflowTaskPriority } from '@watchdog-bms/contracts';
import { ListWorkflowTasksUseCase, SnoozeWorkflowTaskUseCase, CompleteWorkflowTaskUseCase, CancelWorkflowTaskUseCase } from '../../application/use-cases/workflow-task.use-case';

@ApiTags('workflow')
@Controller('companies/:companyId/workflow/tasks')
export class WorkflowTaskController {
  constructor(
    private readonly list: ListWorkflowTasksUseCase,
    private readonly snoozeTask: SnoozeWorkflowTaskUseCase,
    private readonly completeTask: CompleteWorkflowTaskUseCase,
    private readonly cancelTask: CancelWorkflowTaskUseCase,
  ) {}

  @Get()
  @RequirePermissions('workflow.task.read')
  @ApiOperation({ summary: 'List workflow tasks' })
  listTasks(
    @ReqCtx() ctx: RequestContext,
    @Query('scope') scope?: 'own' | 'team' | 'all',
    @Query('status') status?: WorkflowTaskStatus,
    @Query('priority') priority?: WorkflowTaskPriority,
    @Query('sourceModule') sourceModule?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const filter: ListWorkflowTasksFilter = {
      scope, status, priority, sourceModule,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    };
    return this.list.execute(ctx, filter);
  }

  @Post(':taskId/snooze')
  @RequirePermissions('workflow.task.work')
  @HttpCode(200)
  @ApiOperation({ summary: 'Snooze a workflow task' })
  snooze(@ReqCtx() ctx: RequestContext, @Param('taskId') taskId: string, @Body() body: { snoozedUntil: string }) {
    return this.snoozeTask.execute(ctx, taskId, body.snoozedUntil);
  }

  @Post(':taskId/complete')
  @RequirePermissions('workflow.task.work')
  @HttpCode(200)
  @ApiOperation({ summary: 'Complete a workflow task (does not close the source record)' })
  complete(@ReqCtx() ctx: RequestContext, @Param('taskId') taskId: string) {
    return this.completeTask.execute(ctx, taskId);
  }

  @Post(':taskId/cancel')
  @RequirePermissions('workflow.task.work')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cancel a workflow task' })
  cancel(@ReqCtx() ctx: RequestContext, @Param('taskId') taskId: string, @Body() body: { reason?: string }) {
    return this.cancelTask.execute(ctx, taskId, body?.reason);
  }
}
