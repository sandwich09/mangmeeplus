import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import type { Request } from 'express';
import {
  SIGNUP_REJECTION_REASON_MAX_LENGTH,
  type AdminSignupDecisionDto, type AdminSignupQueueDto, type AdminSignupReissueDto,
} from '@watchdog-bms/contracts';
import { RequirePermissions } from '../../../../common/security/permissions.decorator';
import { requiredWebAppBase, trustedPublicApiBase } from '../../../../common/http/public-api-base';
import { AppConfigService } from '../../../../common/config/app-config.service';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import { SignupAdminQueueUseCase } from '../../application/signup-admin-queue.use-case';

export class SignupDecisionRequestDto {
  // SUSPEND (P10-L §3.7) stops an application an admin does not want to keep, most often one
  // AUTO_FREE let through.
  @IsIn(['APPROVE', 'REJECT', 'SUSPEND']) action!: 'APPROVE' | 'REJECT' | 'SUSPEND';
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
  constructor(
    private readonly queue: SignupAdminQueueUseCase,
    private readonly config: AppConfigService,
  ) {}

  @Get()
  @RequirePermissions('system.company_onboarding.read')
  @ApiOperation({ summary: 'List signup applications awaiting review or claim' })
  list(): Promise<AdminSignupQueueDto> {
    return this.queue.list();
  }

  @Get('auto-approved')
  @RequirePermissions('system.company_onboarding.read')
  @ApiOperation({ summary: 'Applications AUTO_FREE approved without an admin, for after-the-fact review' })
  listAutoApproved(): Promise<AdminSignupQueueDto> {
    return this.queue.listAutoApproved();
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
    // Only APPROVE provisions, and only provisioning needs a handoff base. Resolving it for every
    // decision made an unset WEB_BASE_URL a 503 on REJECT and SUSPEND too (review L-4) — and
    // SUSPEND is the emergency stop, which must never depend on a link being configurable.
    // The base is the configured one, never the caller's Origin (review L-1): this URL is
    // PERSISTED as the owner's way back into their shop, and the header is client-suppliable.
    const urls = dto.action === 'APPROVE'
      ? { webBaseUrl: requiredWebAppBase(this.config.sesWebBaseUrl), apiBaseUrl: trustedPublicApiBase(req) }
      : undefined;
    return this.queue.decide(requestId, dto, req.context.userId, req.context.requestId, urls);
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
