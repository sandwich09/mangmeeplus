import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import type { Request } from 'express';
import {
  SIGNUP_REJECTION_REASON_MAX_LENGTH,
  type AdminSignupDecisionDto, type AdminSignupQueueDto, type AdminSignupReissueDto,
} from '@watchdog-bms/contracts';
import { RequirePermissions } from '../../../../common/security/permissions.decorator';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import { SignupAdminQueueUseCase } from '../../application/signup-admin-queue.use-case';

export class SignupDecisionRequestDto {
  @IsIn(['APPROVE', 'REJECT']) action!: 'APPROVE' | 'REJECT';
  @IsBoolean() @IsOptional() notifyApplicant?: boolean;
  // Plain text, bounded: it is copied verbatim into an email body, so it gets the same treatment as
  // any other free-text field crossing a trust boundary. The template escapes it on render.
  @IsString() @MaxLength(SIGNUP_REJECTION_REASON_MAX_LENGTH) @IsOptional() rejectionReason?: string;
}

/**
 * System Admin review queue (spec §4C). Gated by the onboarding permissions rather than a new key:
 * reading the queue is reading pending onboardings, and approving one is what causes a company to
 * be created — so it carries the same authority as creating an onboarding by hand.
 *
 * Route params avoid the name `companyId` on purpose: the auth guard treats that param as tenant
 * scope and would demand membership in the customer company, which system admins never have.
 */
@Controller('system/signup-requests')
export class SystemSignupRequestController {
  constructor(private readonly queue: SignupAdminQueueUseCase) {}

  @Get()
  @RequirePermissions('system.company_onboarding.read')
  @ApiOperation({ summary: 'List signup applications awaiting review or claim' })
  list(): Promise<AdminSignupQueueDto> {
    return this.queue.list();
  }

  @Post(':requestId/decision')
  @HttpCode(200)
  @RequirePermissions('system.company_onboarding.create')
  @ApiOperation({ summary: 'Approve or reject an application (idempotent)' })
  @ApiResponse({ status: 200, description: 'Current state after the decision' })
  @ApiResponse({ status: 409, description: 'Decision does not apply to the current state' })
  decide(
    @Param('requestId') requestId: string,
    @Body() dto: SignupDecisionRequestDto,
    @Req() req: Request & { context: RequestContext },
  ): Promise<AdminSignupDecisionDto> {
    return this.queue.decide(requestId, dto, req.context.userId, req.context.requestId);
  }

  @Post(':requestId/reissue-claim')
  @HttpCode(200)
  @RequirePermissions('system.company_onboarding.create')
  @ApiOperation({ summary: 'Revoke old claim links and send a fresh one (no age limit)' })
  reissue(
    @Param('requestId') requestId: string,
    @Req() req: Request & { context: RequestContext },
  ): Promise<AdminSignupReissueDto> {
    return this.queue.reissue(requestId, req.context.userId, req.context.requestId);
  }
}
