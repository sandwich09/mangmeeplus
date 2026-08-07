import { Controller, Get, Post, Param, Body, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { RequirePermissions } from '../../../../common/security/permissions.decorator';
import { ReqCtx } from '../../../auth/presentation/request-context.decorator';
import type { RequestContext } from '@watchdog-bms/contracts';
import {
  ListReconciliationSessionsUseCase,
  GetReconciliationSessionUseCase,
  CreateReconciliationSessionUseCase,
  CompleteReconciliationSessionUseCase,
  ReopenReconciliationSessionUseCase,
  GetCashPositionUseCase,
} from '../../application/use-cases/reconciliation.use-case';
import { CreateReconciliationSessionDto } from './banking.dtos';

@ApiTags('banking')
@Controller('companies/:companyId/banking')
export class ReconciliationController {
  constructor(
    private readonly listReconciliationSessions: ListReconciliationSessionsUseCase,
    private readonly getReconciliationSession: GetReconciliationSessionUseCase,
    private readonly createReconciliationSession: CreateReconciliationSessionUseCase,
    private readonly completeReconciliationSession: CompleteReconciliationSessionUseCase,
    private readonly reopenReconciliationSession: ReopenReconciliationSessionUseCase,
    private readonly getCashPosition: GetCashPositionUseCase,
  ) {}

  @Get('reconciliations')
  @RequirePermissions('bank.reconciliation.read')
  @ApiOperation({ summary: 'List reconciliation sessions' })
  async list(@ReqCtx() ctx: RequestContext) {
    return this.listReconciliationSessions.execute(ctx);
  }

  @Post('reconciliations')
  @RequirePermissions('bank.reconciliation.create')
  @ApiOperation({ summary: 'Create reconciliation session' })
  async create(@ReqCtx() ctx: RequestContext, @Body() body: CreateReconciliationSessionDto) {
    return this.createReconciliationSession.execute(ctx, body);
  }

  @Get('reconciliations/:sessionId')
  @RequirePermissions('bank.reconciliation.read')
  @ApiOperation({ summary: 'Get reconciliation session by id' })
  async getOne(@ReqCtx() ctx: RequestContext, @Param('sessionId') sessionId: string) {
    return this.getReconciliationSession.execute(ctx, sessionId);
  }

  @Post('reconciliations/:sessionId/complete')
  @RequirePermissions('bank.reconciliation.complete')
  @HttpCode(200)
  @ApiOperation({ summary: 'Complete reconciliation session' })
  async complete(
    @ReqCtx() ctx: RequestContext,
    @Param('sessionId') sessionId: string,
    @Body() body?: { snapshotLines?: Array<{ statementLineId: string; statusAtCompletion: string; matchedAmountAtCompletion: string; ignoredReasonAtCompletion?: string }> },
  ) {
    return this.completeReconciliationSession.execute(ctx, sessionId, body?.snapshotLines);
  }

  @Post('reconciliations/:sessionId/reopen')
  @RequirePermissions('bank.reconciliation.reopen')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reopen completed reconciliation session' })
  async reopen(
    @ReqCtx() ctx: RequestContext,
    @Param('sessionId') sessionId: string,
    @Body() body: { reason: string },
  ) {
    return this.reopenReconciliationSession.execute(ctx, sessionId, body.reason);
  }

  @Get('cash-position')
  @RequirePermissions('bank.cash.read')
  @ApiOperation({ summary: 'Get cash position summary' })
  async cashPosition(@ReqCtx() ctx: RequestContext) {
    return this.getCashPosition.execute(ctx);
  }
}
