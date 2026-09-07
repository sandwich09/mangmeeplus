import {
  Body, Controller, ForbiddenException, Get, Headers, HttpCode, Post, Req, UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsObject, IsOptional, IsString, Matches, MaxLength, ValidateNested } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import type { Request } from 'express';
import type { LineSignupStatusDto, LineSignupSubmitAcceptedDto } from '@watchdog-bms/contracts';
import { AppConfigService } from '../../../../common/config/app-config.service';
import { publicApiBase, requiredWebAppBase } from '../../../../common/http/public-api-base';
import { Public } from '../../../../common/security/public.decorator';
import { LINE_ID_TOKEN_MAX_LENGTH, LINE_ID_TOKEN_PATTERN } from '../../../../common/security/liff-page.security';
import { trustedClientIp } from '../../../../common/security/trusted-client-ip';
import { AuthRateLimitService } from '../../../auth/application/auth-rate-limit.service';
import { GetLineSignupStatusUseCase } from '../../application/get-line-signup-status.use-case';
import { SubmitLineSignupUseCase } from '../../application/submit-line-signup.use-case';
import { LINE_SIGNUP_COMPANY_NAME_MAX, LINE_SIGNUP_CONTACT_EMAIL_MAX, LINE_SIGNUP_REFERRAL_CODE_MAX } from '../../domain/line-signup.logic';

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
  // Required since Owner 2026-09-05 (spec §3.2). Digits, spaces and dashes only; the use-case
  // decides whether they add up to a Thai mobile, and answers `line_signup_phone_*` when they do not.
  @IsString() @IsNotEmpty() @MaxLength(20) @Matches(/^[0-9 -]*$/) phoneNumber!: string;
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  @IsEmail() @MaxLength(LINE_SIGNUP_CONTACT_EMAIL_MAX) contactEmail!: string;
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
      phoneNumber: dto.phoneNumber,
      contactEmail: dto.contactEmail,
      ...(dto.referralCode ? { referralCode: dto.referralCode } : {}),
      legal: dto.legal,
      ...(req.headers['user-agent'] ? { userAgent: String(req.headers['user-agent']) } : {}),
      correlationRequestId: requestIdOf(req),
      // Not the Origin (this request comes from a LIFF page the API itself serves) and not the
      // loose accessor (which falls back to the API's own origin): an AUTO_FREE submit persists
      // this as the owner's handoff URL.
      webBaseUrl: requiredWebAppBase(this.config.sesWebBaseUrl),
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

}

function requestIdOf(req: Request): string {
  return (req.headers['x-request-id'] as string | undefined) ?? `line-signup-${Date.now()}`;
}
