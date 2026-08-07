import { Controller, Get, Post, Param, Body, Query, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { RequirePermissions } from '../../../../common/security/permissions.decorator';
import { ReqCtx } from '../../../auth/presentation/request-context.decorator';
import type { RequestContext, ListWorkflowDeadLettersFilter, WorkflowDeadLetterResolutionStatus } from '@watchdog-bms/contracts';
import { ListWorkflowDeadLettersUseCase, ReplayWorkflowDeadLetterUseCase, IgnoreWorkflowDeadLetterUseCase } from '../../application/use-cases/workflow-dead-letter.use-case';

@ApiTags('workflow')
@Controller('companies/:companyId/workflow/dead-letters')
export class WorkflowDeadLetterController {
  constructor(
    private readonly list: ListWorkflowDeadLettersUseCase,
    private readonly replayDeadLetter: ReplayWorkflowDeadLetterUseCase,
    private readonly ignoreDeadLetter: IgnoreWorkflowDeadLetterUseCase,
  ) {}

  @Get()
  @RequirePermissions('workflow.dead_letter.read')
  @ApiOperation({ summary: 'List workflow dead letters' })
  listDeadLetters(
    @ReqCtx() ctx: RequestContext,
    @Query('resolutionStatus') resolutionStatus?: WorkflowDeadLetterResolutionStatus,
    @Query('ruleId') ruleId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const filter: ListWorkflowDeadLettersFilter = {
      resolutionStatus, ruleId,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    };
    return this.list.execute(ctx, filter);
  }

  @Post(':deadLetterId/replay')
  @RequirePermissions('workflow.dead_letter.replay')
  @HttpCode(200)
  @ApiOperation({ summary: 'Replay a dead letter (re-validates permission/source state/idempotency)' })
  replay(@ReqCtx() ctx: RequestContext, @Param('deadLetterId') deadLetterId: string) {
    return this.replayDeadLetter.execute(ctx, deadLetterId);
  }

  @Post(':deadLetterId/ignore')
  @RequirePermissions('workflow.dead_letter.replay')
  @HttpCode(200)
  @ApiOperation({ summary: 'Ignore a dead letter (requires a resolution note)' })
  ignore(@ReqCtx() ctx: RequestContext, @Param('deadLetterId') deadLetterId: string, @Body() body: { resolutionNote: string }) {
    return this.ignoreDeadLetter.execute(ctx, deadLetterId, body?.resolutionNote);
  }
}
