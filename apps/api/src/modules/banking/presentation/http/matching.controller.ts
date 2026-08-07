import { Controller, Get, Post, Param, Body, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { RequirePermissions } from '../../../../common/security/permissions.decorator';
import { ReqCtx } from '../../../auth/presentation/request-context.decorator';
import type { RequestContext } from '@watchdog-bms/contracts';
import {
  ListMatchCandidatesUseCase,
  ConfirmMatchUseCase,
  RejectMatchUseCase,
  VoidMatchUseCase,
  IgnoreStatementLineUseCase,
} from '../../application/use-cases/matching.use-case';

@ApiTags('banking')
@Controller('companies/:companyId/banking')
export class MatchingController {
  constructor(
    private readonly listMatchCandidates: ListMatchCandidatesUseCase,
    private readonly confirmMatch: ConfirmMatchUseCase,
    private readonly rejectMatch: RejectMatchUseCase,
    private readonly voidMatch: VoidMatchUseCase,
    private readonly ignoreStatementLine: IgnoreStatementLineUseCase,
  ) {}

  @Get('bank-accounts/:bankAccountId/match-candidates')
  @RequirePermissions('bank.match.read')
  @ApiOperation({ summary: 'List match candidates for a bank account' })
  async listCandidates(@ReqCtx() ctx: RequestContext, @Param('bankAccountId') bankAccountId: string) {
    return this.listMatchCandidates.execute(ctx, bankAccountId);
  }

  @Post('statement-lines/:statementLineId/matches')
  @RequirePermissions('bank.match.confirm')
  @ApiOperation({ summary: 'Confirm a match for a statement line' })
  async confirm(
    @ReqCtx() ctx: RequestContext,
    @Param('statementLineId') statementLineId: string,
    @Body() body: { sourceType: string; sourceId: string; sourceDisplayNumber?: string; allocatedAmount: string; currency: string; overrideReason?: string },
  ) {
    return this.confirmMatch.execute(ctx, { statementLineId, ...body });
  }

  @Post('matches/:matchId/reject')
  @RequirePermissions('bank.match.confirm')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reject a match' })
  async reject(
    @ReqCtx() ctx: RequestContext,
    @Param('matchId') matchId: string,
    @Body() body: { reason: string },
  ) {
    return this.rejectMatch.execute(ctx, matchId, body.reason);
  }

  @Post('matches/:matchId/void')
  @RequirePermissions('bank.match.unmatch')
  @HttpCode(200)
  @ApiOperation({ summary: 'Void a confirmed match' })
  async void(@ReqCtx() ctx: RequestContext, @Param('matchId') matchId: string) {
    return this.voidMatch.execute(ctx, matchId);
  }

  @Post('statement-lines/:statementLineId/ignore')
  @RequirePermissions('bank.match.override')
  @HttpCode(200)
  @ApiOperation({ summary: 'Ignore a statement line' })
  async ignore(
    @ReqCtx() ctx: RequestContext,
    @Param('statementLineId') statementLineId: string,
    @Body() body: { reason: string },
  ) {
    return this.ignoreStatementLine.execute(ctx, statementLineId, body.reason);
  }
}
