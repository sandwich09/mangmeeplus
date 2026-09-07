import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import {
  IsBoolean, IsIn, IsInt, IsNumberString, IsOptional, IsString, Matches, MaxLength, Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { Request } from 'express';
import {
  COMPANY_BUSINESS_CATEGORIES,
  SIGNUP_REJECTION_REASON_MAX_LENGTH, SIGNUP_RESOLUTION_NOTE_MAX_LENGTH,
  type AdminSignupDecisionBody, type AdminSignupDecisionDto, type AdminSignupQueueDto, type AdminSignupReissueDto,
} from '@watchdog-bms/contracts';
import { RequirePermissions } from '../../../../common/security/permissions.decorator';
import { requiredWebAppBase, trustedPublicApiBase } from '../../../../common/http/public-api-base';
import { AppConfigService } from '../../../../common/config/app-config.service';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import { SignupAdminQueueUseCase } from '../../application/signup-admin-queue.use-case';

export class SignupDecisionRequestDto {
  // SUSPEND (P10-L §3.7) stops an application an admin does not want to keep, most often one
  // AUTO_FREE let through.
  @IsIn(['APPROVE', 'CREATE_NEW_SHOP', 'RETURN_EXISTING', 'REQUEST_INFO', 'RETRY_INTAKE', 'REJECT', 'SUSPEND'])
  action!: AdminSignupDecisionBody['action'];
  @Type(() => Number) @IsInt() @Min(0) @IsOptional() version?: number;
  @IsString() @MaxLength(128) @IsOptional() targetCompanyId?: string;
  @IsBoolean() @IsOptional() grantRepeatTrial?: boolean;
  @IsString() @MaxLength(SIGNUP_RESOLUTION_NOTE_MAX_LENGTH) @IsOptional() trialGrantNote?: string;
  @IsBoolean() @IsOptional() acknowledgeSharedContact?: boolean;
  @IsString() @MaxLength(SIGNUP_RESOLUTION_NOTE_MAX_LENGTH) @IsOptional() sharedContactNote?: string;
  @IsString() @MaxLength(SIGNUP_RESOLUTION_NOTE_MAX_LENGTH) @IsOptional() resolutionNote?: string;
  // R10, APPROVE only: the enum the reviewer picked, because the form's free text ("คลินิก") maps
  // to OTHER and left the PDPA health tripwire dead. Bounded to the closed enum here, and checked
  // again in the use case — the value decides whether a safeguard fires.
  @IsIn(COMPANY_BUSINESS_CATEGORIES as unknown as string[]) @IsOptional() businessCategory?: string;
  @IsBoolean() @IsOptional() notifyApplicant?: boolean;
  // Plain text, bounded: it is copied verbatim into an email body, so it gets the same treatment as
  // any other free-text field crossing a trust boundary. The template escapes it on render.
  @IsString() @MaxLength(SIGNUP_REJECTION_REASON_MAX_LENGTH) @IsOptional() rejectionReason?: string;
}

/** R13: the queue's page and tab, arriving as a query string, so each one is bounded here. */
export class SignupQueueQueryDto {
  // Unknown values are not an error — the use case falls through to the whole actionable queue —
  // but the set is closed so a caller cannot invent a filter the counts do not know about.
  @IsIn(['ALL', 'PENDING_REVIEW', 'AWAITING_CLAIM', 'PROBLEM', 'ARCHIVED']) @IsOptional() tab?: string;
  // Minted by `encodeQueueCursor`, never typed: base64url of `<ISO createdAt>|<cuid>`, which is 67
  // characters for a cuid today. The bound was 64 while the cursor was a bare id, so F10's change
  // of shape turned every "load more" into a 400 before the query reached the use case. 128 leaves
  // room for a longer id without becoming an unbounded query parameter.
  @IsString() @MaxLength(128) @Matches(/^[A-Za-z0-9_-]+$/) @IsOptional() cursor?: string;
  @IsNumberString() @IsOptional() limit?: string;
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
  @ApiOperation({ summary: 'List one page of one tab of the signup queue, with whole-queue counts' })
  list(@Query() query: SignupQueueQueryDto): Promise<AdminSignupQueueDto> {
    // R13: the tab and the page belong to the database, not to a browser filtering 200 rows. The
    // DTO bounds all three; an unknown tab falls through to the whole actionable queue.
    return this.queue.list(new Date(), {
      ...(query.tab ? { tab: query.tab } : {}),
      ...(query.cursor ? { cursor: query.cursor } : {}),
      ...(query.limit ? { limit: Number(query.limit) } : {}),
    });
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
    const urls = ['APPROVE', 'CREATE_NEW_SHOP', 'RETRY_INTAKE'].includes(dto.action)
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
