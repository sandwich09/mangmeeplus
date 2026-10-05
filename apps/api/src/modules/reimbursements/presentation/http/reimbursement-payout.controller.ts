import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AddSavedPayoutAccountInput, RequestContext, SetMemberPayoutAccountInput, SubmitReimbursementPayoutCorrectionInput } from '@watchdog-bms/contracts';
import { RequireAnyPermission, RequirePermissions } from '../../../../common/security/permissions.decorator';
import { ReqCtx } from '../../../auth/presentation/request-context.decorator';
import { MemberPayoutAccountUseCase } from '../../application/use-cases/reimbursement-payout.use-case';
import { RevealClaimPayoutUseCase } from '../../application/use-cases/reimbursement-payout-reveal.use-case';
import { RequestPayoutCorrectionUseCase, SubmitPayoutCorrectionUseCase } from '../../application/use-cases/reimbursement-payout-correction.use-case';
import { ReimbursementWriteQuiesceGuard } from './reimbursement-write-quiesce.guard';
import { AddSavedPayoutAccountDto, RequestPayoutCorrectionDto, SetMemberPayoutAccountDto, SubmitPayoutCorrectionDto } from './reimbursement.dtos';

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
    private readonly requestCorrection: RequestPayoutCorrectionUseCase,
    private readonly submitCorrection: SubmitPayoutCorrectionUseCase,
  ) {}

  @Get('payout-accounts/me/saved')
  @RequirePermissions('reimbursement.create')
  listSavedOwn(@ReqCtx() ctx: RequestContext) {
    return this.accounts.listSavedOwn(ctx);
  }

  @Post('payout-accounts/me/saved')
  @RequirePermissions('reimbursement.create')
  addSavedOwn(@ReqCtx() ctx: RequestContext, @Body() body: AddSavedPayoutAccountDto) {
    return this.accounts.addSavedOwn(ctx, body as AddSavedPayoutAccountInput);
  }

  @Delete('payout-accounts/me/saved/:accountId')
  @RequirePermissions('reimbursement.create')
  @HttpCode(204)
  deleteSavedOwn(@ReqCtx() ctx: RequestContext, @Param('accountId') id: string) {
    return this.accounts.deleteSavedOwn(ctx, id);
  }

  @Post('payout-accounts/me/saved/:accountId/reveal')
  @RequirePermissions('reimbursement.create')
  @HttpCode(200)
  revealSavedOwn(@ReqCtx() ctx: RequestContext, @Param('accountId') id: string) {
    return this.accounts.revealSavedOwn(ctx, id);
  }

  @Post('payout-accounts/me/saved/:accountId/make-default')
  @RequirePermissions('reimbursement.create')
  @HttpCode(200)
  makeSavedDefaultOwn(@ReqCtx() ctx: RequestContext, @Param('accountId') id: string) {
    return this.accounts.makeSavedDefaultOwn(ctx, id);
  }

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

  // ---- Correcting the account after approval (payout spec §14) ----

  @Post(':requestId/payout-correction')
  // Like the claim detail and the reveal: the use case decides by who the caller is to this claim
  // (whoever may record its payment, its approver, its requester), which no single permission says.
  @RequirePermissions('account.session.read')
  @HttpCode(200)
  @ApiOperation({ summary: 'Send an approved claim back to have its payout account corrected (same claim and number)' })
  requestPayoutCorrection(@ReqCtx() ctx: RequestContext, @Param('requestId') requestId: string, @Body() body: RequestPayoutCorrectionDto) {
    return this.requestCorrection.execute(ctx, requestId, body);
  }

  @Put(':requestId/payout-destination')
  @RequireAnyPermission('reimbursement.update_own_draft', 'reimbursement.finance_review')
  @ApiOperation({ summary: 'Give the payout account of a claim sent back for correction (its requester, or finance review on their behalf)' })
  submitPayoutCorrection(@ReqCtx() ctx: RequestContext, @Param('requestId') requestId: string, @Body() body: SubmitPayoutCorrectionDto) {
    return this.submitCorrection.execute(ctx, requestId, body as SubmitReimbursementPayoutCorrectionInput);
  }
}
