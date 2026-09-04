import {
  Body, Controller, ForbiddenException, Get, Headers, HttpCode, Post, Req,
  ServiceUnavailableException, UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import { IsNotEmpty, IsObject, IsOptional, IsString, Matches, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import type { Request } from 'express';
import type { LineSignupStatusDto, LineSignupSubmitAcceptedDto } from '@watchdog-bms/contracts';
import { AppConfigService } from '../../../../common/config/app-config.service';
import { publicApiBase } from '../../../../common/http/public-api-base';
import { Public } from '../../../../common/security/public.decorator';
import { LINE_ID_TOKEN_MAX_LENGTH, LINE_ID_TOKEN_PATTERN } from '../../../../common/security/liff-page.security';
import { trustedClientIp } from '../../../../common/security/trusted-client-ip';
import { AuthRateLimitService } from '../../../auth/application/auth-rate-limit.service';
import { GetLineSignupStatusUseCase } from '../../application/get-line-signup-status.use-case';
import { SubmitLineSignupUseCase } from '../../application/submit-line-signup.use-case';
import { LINE_SIGNUP_COMPANY_NAME_MAX, LINE_SIGNUP_REFERRAL_CODE_MAX } from '../../domain/line-signup.logic';

const SHA256_HEX = /^[a-f0-9]{64}$/;

export class LineSignupLegalDto {
  @IsString() @Matches(/^v\d+$/) documentVersion!: string;
  @IsString() @Matches(SHA256_HEX) statementSha256!: string;
  @IsString() @Matches(SHA256_HEX) releaseFingerprintSha256!: string;
  @IsString() @Matches(SHA256_HEX) displayChallenge!: string;
  @IsString() @Matches(/^(th|en)$/) locale!: string;
}

export class LineSignupSubmitBodyDto {
  @IsString() @MaxLength(LINE_ID_TOKEN_MAX_LENGTH) @Matches(LINE_ID_TOKEN_PATTERN) idToken!: string;
  @IsString() @IsNotEmpty() @MaxLength(LINE_SIGNUP_COMPANY_NAME_MAX) companyName!: string;
  // Optional by design (spec §3.2). Digits, spaces and dashes only; the use-case decides validity.
  @IsString() @IsOptional() @MaxLength(20) @Matches(/^[0-9 -]*$/) phoneNumber?: string;
  @IsString() @IsOptional() @MaxLength(LINE_SIGNUP_REFERRAL_CODE_MAX) @Matches(/^[A-Za-z0-9_-]*$/) referralCode?: string;
  @IsObject() @ValidateNested() @Type(() => LineSignupLegalDto) legal!: LineSignupLegalDto;
}

/**
 * P10-L §4. Public ingress for the LIFF signup form: no session, no secret, and no identifier the
 * caller can choose — the LIFF ID token is the only identity input, and everything else on the
 * request is treated as a claim to be checked.
 *
 * The flag closes BOTH routes here, unlike Flow B's asymmetric switch: nobody is mid-flow holding a
 * link that turning it off would strand, because this flow has no links.
 */
@Public()
@Controller('public')
export class PublicLineSignupController {
  constructor(
    private readonly config: AppConfigService,
    private readonly rateLimit: AuthRateLimitService,
    private readonly submit: SubmitLineSignupUseCase,
    private readonly status: GetLineSignupStatusUseCase,
  ) {}

  @Post('line-signups')
  @HttpCode(202)
  @ApiOperation({ summary: 'Submit a LINE-first company signup from the LIFF form' })
  @ApiResponse({ status: 202, description: 'Application received; MANUAL queues it, AUTO_FREE provisions it' })
  @ApiResponse({ status: 401, description: 'LINE ID token invalid, expired or for another channel' })
  @ApiResponse({ status: 409, description: 'Legal release changed, or this LINE account already has an open application' })
  async create(
    @Body() dto: LineSignupSubmitBodyDto,
    @Req() req: Request,
  ): Promise<LineSignupSubmitAcceptedDto> {
    this.assertEnabled();
    // Charged before the verification round trip, which is the expensive part (spec §9).
    await this.rateLimit.assertLineSignupIpAllowed(trustedClientIp(req));
    return this.submit.execute({
      idToken: dto.idToken,
      companyName: dto.companyName,
      ...(dto.phoneNumber ? { phoneNumber: dto.phoneNumber } : {}),
      ...(dto.referralCode ? { referralCode: dto.referralCode } : {}),
      legal: dto.legal,
      ...(req.headers['user-agent'] ? { userAgent: String(req.headers['user-agent']) } : {}),
      correlationRequestId: requestIdOf(req),
      webBaseUrl: this.webBaseUrl(),
      apiBaseUrl: publicApiBase(req),
    });
  }

  @Get('line-signups/me')
  @ApiOperation({ summary: 'The latest application belonging to the LINE account this token proves' })
  @ApiResponse({ status: 200, description: 'The application, or null when this LINE account has none' })
  async readStatus(
    // In a header, not a query string: an ID token is a credential and must never reach a URL,
    // an access log or a Referer (spec §9).
    @Headers('x-line-id-token') idToken: string | undefined,
    @Req() req: Request,
  ): Promise<LineSignupStatusDto> {
    this.assertEnabled();
    await this.rateLimit.assertLineSignupReadAllowed(trustedClientIp(req));
    if (!idToken || idToken.length > LINE_ID_TOKEN_MAX_LENGTH || !LINE_ID_TOKEN_PATTERN.test(idToken)) {
      throw new UnauthorizedException('LINE Login token format is invalid.');
    }
    return this.status.execute(idToken);
  }

  /** Mirrors `external_signup_disabled`: the switch is the rollback, so it answers before any work. */
  private assertEnabled(): void {
    if (!this.config.lineSignupEnabled) throw new ForbiddenException('line_signup_disabled');
  }

  /**
   * Where the shop owner's handoff link must land. Deliberately NOT `config.webBaseUrl`, which
   * falls back to `PUBLIC_BASE_URL` — the API's own origin — and deliberately not the request
   * Origin either, because this request comes from a LIFF page the API itself serves. Both would
   * quietly persist an API-host link as the owner's "open my shop" URL on an AUTO_FREE submit.
   *
   * `sesWebBaseUrl` is `WEB_BASE_URL` and nothing else: the same accessor SES uses for exactly
   * this reason. Unset is a deployment fault, not a caller fault, so it refuses rather than
   * storing a link nobody can follow. UAT and production both set it, and the flow is flag-gated
   * on top of that, so this cannot fire where it would matter.
   */
  private webBaseUrl(): string {
    const configured = this.config.sesWebBaseUrl;
    if (!configured) {
      throw new ServiceUnavailableException('line_signup_web_base_url_missing');
    }
    return configured;
  }
}

function requestIdOf(req: Request): string {
  return (req.headers['x-request-id'] as string | undefined) ?? `line-signup-${Date.now()}`;
}
