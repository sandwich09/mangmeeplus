import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { RequestContext, SetMemberPayoutAccountInput } from '@watchdog-bms/contracts';
import { RequireAnyPermission, RequirePermissions } from '../../../../common/security/permissions.decorator';
import { ReqCtx } from '../../../auth/presentation/request-context.decorator';
import { MemberPayoutAccountUseCase } from '../../application/use-cases/reimbursement-payout.use-case';
import { RevealClaimPayoutUseCase } from '../../application/use-cases/reimbursement-payout-reveal.use-case';
import { ReimbursementWriteQuiesceGuard } from './reimbursement-write-quiesce.guard';
import { SetMemberPayoutAccountDto } from './reimbursement.dtos';

/**
 * Payout account endpoints. A controller of its own under the reimbursements path, registered ahead
 * of ReimbursementController so `payout-accounts/…` is matched before `:requestId`.
 *
 * Every answer here carries the last 4 digits only, except the two `reveal` calls: those return the
 * full number, each checks its own group and each writes an audit row first.
 */
@ApiTags('reimbursements')
@UseGuards(ReimbursementWriteQuiesceGuard)
@Controller('companies/:companyId/reimbursements')
export class ReimbursementPayoutController {
  constructor(
    private readonly accounts: MemberPayoutAccountUseCase,
    private readonly revealClaim: RevealClaimPayoutUseCase,
  ) {}

  @Get('payout-accounts/me')
  @RequirePermissions('reimbursement.create')
  @ApiOperation({ summary: 'Get my default payout account (last 4 digits only)' })
  getOwn(@ReqCtx() ctx: RequestContext) {
    return this.accounts.getOwn(ctx);
  }

  @Put('payout-accounts/me')
  @RequirePermissions('reimbursement.create')
  @ApiOperation({ summary: 'Set my default payout account' })
  setOwn(@ReqCtx() ctx: RequestContext, @Body() body: SetMemberPayoutAccountDto) {
    return this.accounts.setOwn(ctx, body as SetMemberPayoutAccountInput);
  }

  @Delete('payout-accounts/me')
  @RequirePermissions('reimbursement.create')
  @ApiOperation({ summary: 'Remove my default payout account' })
  deleteOwn(@ReqCtx() ctx: RequestContext) {
    return this.accounts.deleteOwn(ctx);
  }

  @Post('payout-accounts/me/reveal')
  @RequirePermissions('reimbursement.create')
  @HttpCode(200)
  @ApiOperation({ summary: 'Show my own full account number (audited)' })
  revealOwn(@ReqCtx() ctx: RequestContext) {
    return this.accounts.revealOwn(ctx);
  }

  @Get('payout-accounts/members/:userId')
  @RequireAnyPermission('access.employee.read', 'access.employee.update')
  @ApiOperation({ summary: 'Get an employee default payout account (last 4 digits only)' })
  getForMember(@ReqCtx() ctx: RequestContext, @Param('userId') userId: string) {
    return this.accounts.getForMember(ctx, userId);
  }

  @Put('payout-accounts/members/:userId')
  @RequirePermissions('access.employee.update')
  @ApiOperation({ summary: 'Set an employee default payout account (audited, the employee is notified)' })
  setForMember(@ReqCtx() ctx: RequestContext, @Param('userId') userId: string, @Body() body: SetMemberPayoutAccountDto) {
    return this.accounts.setForMember(ctx, userId, body as SetMemberPayoutAccountInput);
  }

  @Post(':requestId/payout-destination/reveal')
  // Like the claim detail: the session permission satisfies the global guard, and the use case
  // decides by the claim's own reveal group (requester, that claim's approver, payment recorder).
  @RequirePermissions('account.session.read')
  @HttpCode(200)
  @ApiOperation({ summary: "Show the full account number of a claim's own snapshot (audited)" })
  revealForClaim(@ReqCtx() ctx: RequestContext, @Param('requestId') requestId: string) {
    return this.revealClaim.execute(ctx, requestId);
  }
}
