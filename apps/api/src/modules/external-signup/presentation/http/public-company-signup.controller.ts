import {
  Body, Controller, ForbiddenException, Get, HttpCode, HttpException, HttpStatus, Param, Post, Req, UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import {
  IsBoolean, IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, MinLength,
} from 'class-validator';
import type { Request } from 'express';
import type {
  PublicCompanySignupAcceptedDto, PublicSignupStatusDto, SignupClaimInfoDto, SignupClaimResultDto,
} from '@watchdog-bms/contracts';
import { AppConfigService } from '../../../../common/config/app-config.service';
import { publicApiBase } from '../../../../common/http/public-api-base';
import { Public } from '../../../../common/security/public.decorator';
import { trustedClientIp } from '../../../../common/security/trusted-client-ip';
import { AuthRateLimitService } from '../../../auth/application/auth-rate-limit.service';
import { SubmitCompanySignupUseCase } from '../../application/submit-company-signup.use-case';
import { PublicSignupStatusUseCase } from '../../application/public-signup-status.use-case';
import { SignupClaimUseCase } from '../../application/signup-claim.use-case';

const CUID_PATTERN = /^[A-Za-z0-9_-]{20,40}$/;
const CLAIM_TOKEN_PATTERN = /^[A-Za-z0-9_-]{40,64}$/;
const USERNAME_PATTERN = /^[a-zA-Z0-9._-]+$/;
const PHONE_PATTERN = /^[0-9+\-() ]{6,20}$/;

export class PublicCompanySignupDto {
  @IsString() @IsNotEmpty() @MaxLength(128) @Matches(/^[A-Za-z0-9_:-]+$/) externalSignupId!: string;
  @IsString() @IsNotEmpty() @MaxLength(200) companyName!: string;
  @IsString() @IsNotEmpty() @MaxLength(160) ownerDisplayName!: string;
  @IsEmail() @MaxLength(254) contactEmail!: string;
  @IsString() @IsOptional() @Matches(PHONE_PATTERN) phoneNumber?: string;
  @IsString() @IsOptional() @MaxLength(120) businessType?: string;
  @IsBoolean() @IsOptional() vatRegistered?: boolean;
  @IsString() @IsOptional() @MaxLength(32) @Matches(/^[0-9 -]*$/) taxId?: string;
  @IsString() @IsNotEmpty() @MaxLength(64) consentVersion!: string;
  @IsString() @IsOptional() @MaxLength(128) @Matches(/^[A-Za-z0-9_-]*$/) referralCode?: string;
  // Only PRO_TRIAL is sellable today; the domain re-checks and answers `offer_not_available`
  // rather than falling back to the trial silently (spec §3A).
  @IsIn(['PRO_TRIAL', 'STARTER_249', 'BASIC_499', 'PRO_999', 'ENTERPRISE_1999']) @IsOptional() requestedOfferKey?: string;
}

export class SignupClaimSetPasswordDto {
  @IsString() @Matches(CLAIM_TOKEN_PATTERN) token!: string;
  @IsString() @IsNotEmpty() @MinLength(3) @MaxLength(40) @Matches(USERNAME_PATTERN) username!: string;
  // Same floor the change-password endpoint enforces — one password policy for the whole product.
  @IsString() @MinLength(8) @MaxLength(128) password!: string;
}

export class SignupClaimAttachDto {
  @IsString() @Matches(CLAIM_TOKEN_PATTERN) token!: string;
  @IsString() @IsNotEmpty() @MaxLength(254) identifier!: string;
  @IsString() @IsNotEmpty() @MaxLength(128) password!: string;
}

/**
 * Public ingress for Flow B (spec §3). Same-origin, no secret, rate-limited before any work —
 * the `customer-line-register` precedent.
 *
 * Flag behaviour is deliberately asymmetric: `EXTERNAL_SIGNUP_ENABLED=false` closes the *intake*
 * (availability says so, POST is 403), but status and claim routes stay open. Turning the flag off
 * must never strand an applicant who was already approved and is holding a live link.
 */
@Public()
@Controller('public')
export class PublicCompanySignupController {
  constructor(
    private readonly config: AppConfigService,
    private readonly rateLimit: AuthRateLimitService,
    private readonly submit: SubmitCompanySignupUseCase,
    private readonly status: PublicSignupStatusUseCase,
    private readonly claim: SignupClaimUseCase,
  ) {}

  @Get('company-signups/availability')
  @ApiOperation({ summary: 'Whether public self-service signup is open' })
  availability(): { enabled: boolean } {
    return { enabled: this.config.externalSignupEnabled };
  }

  @Post('company-signups')
  @HttpCode(202)
  @ApiOperation({ summary: 'Submit a public company signup application' })
  @ApiResponse({ status: 202, description: 'Application received and queued for review' })
  @ApiResponse({ status: 409, description: 'Same externalSignupId with a different payload' })
  @ApiResponse({ status: 422, description: 'Invalid payload or email domain without MX' })
  async create(
    @Body() dto: PublicCompanySignupDto,
    @Req() req: Request,
  ): Promise<PublicCompanySignupAcceptedDto> {
    if (!this.config.externalSignupEnabled) throw new ForbiddenException('external_signup_disabled');
    const ip = trustedClientIp(req);
    await this.rateLimit.assertPublicSignupAllowed(ip, dto.contactEmail);
    return this.submit.execute(
      {
        externalSignupId: dto.externalSignupId,
        companyName: dto.companyName,
        ownerDisplayName: dto.ownerDisplayName,
        contactEmail: dto.contactEmail,
        ...(dto.phoneNumber ? { phoneNumber: dto.phoneNumber } : {}),
        ...(dto.businessType ? { businessType: dto.businessType } : {}),
        ...(dto.vatRegistered !== undefined ? { vatRegistered: dto.vatRegistered } : {}),
        ...(dto.taxId ? { taxId: dto.taxId } : {}),
        consentVersion: dto.consentVersion,
        ...(dto.referralCode ? { referralCode: dto.referralCode } : {}),
        ...(dto.requestedOfferKey ? { requestedOfferKey: dto.requestedOfferKey } : {}),
      },
      requestIdOf(req),
    );
  }

  @Get('company-signups/:requestId')
  @ApiOperation({ summary: 'Coarse public status of an application' })
  async readStatus(
    @Param('requestId') requestId: string,
    @Req() req: Request,
  ): Promise<PublicSignupStatusDto> {
    await this.rateLimit.assertPublicSignupReadAllowed(trustedClientIp(req));
    assertIdShape(requestId);
    return this.status.status(requestId);
  }

  @Post('company-signups/:requestId/resend-claim')
  @HttpCode(202)
  @ApiOperation({ summary: 'Ask for a fresh claim email' })
  async resendClaim(
    @Param('requestId') requestId: string,
    @Req() req: Request,
  ): Promise<{ queued: true }> {
    assertIdShape(requestId);
    await this.rateLimit.assertPublicSignupResendAllowed(trustedClientIp(req), requestId);
    await this.status.resendClaim(requestId, requestIdOf(req));
    return { queued: true };
  }

  @Get('signup-claims/:token')
  @ApiOperation({ summary: 'Claim link details; identical empty answer for expired/used/unknown' })
  async claimInfo(@Param('token') token: string, @Req() req: Request): Promise<SignupClaimInfoDto> {
    await this.rateLimit.assertPublicSignupReadAllowed(trustedClientIp(req));
    // A malformed token is answered exactly like an unknown one — no shape oracle either.
    if (!CLAIM_TOKEN_PATTERN.test(token)) return { valid: false };
    return this.claim.info(token);
  }

  @Post('signup-claims/set-password')
  @HttpCode(200)
  @ApiOperation({ summary: 'Claim: set a password for a new account, then provision' })
  async setPassword(
    @Body() dto: SignupClaimSetPasswordDto,
    @Req() req: Request,
  ): Promise<SignupClaimResultDto> {
    await this.rateLimit.assertSignupClaimSubmitAllowed(trustedClientIp(req));
    return this.claim.setPassword({
      token: dto.token,
      username: dto.username,
      password: dto.password,
      correlationRequestId: requestIdOf(req),
      webBaseUrl: webAppBase(req),
      apiBaseUrl: publicApiBase(req),
    });
  }

  @Post('signup-claims/attach')
  @HttpCode(200)
  @ApiOperation({ summary: 'Claim: attach the new company to an existing account, then provision' })
  async attach(
    @Body() dto: SignupClaimAttachDto,
    @Req() req: Request,
  ): Promise<SignupClaimResultDto> {
    const ip = trustedClientIp(req);
    await this.rateLimit.assertSignupClaimSubmitAllowed(ip);
    // The very buckets `/v1/auth/login` uses. Password guessing through this page must cost
    // exactly what guessing through the login form costs — this route is not a softer door.
    await this.rateLimit.assertPasswordLoginAllowed(dto.identifier, ip);
    try {
      return await this.claim.attach({
        token: dto.token,
        identifier: dto.identifier,
        password: dto.password,
        correlationRequestId: requestIdOf(req),
        webBaseUrl: webAppBase(req),
        apiBaseUrl: publicApiBase(req),
      });
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        await this.rateLimit.recordPasswordLoginFailure(dto.identifier, ip);
      }
      throw error;
    }
  }
}

function requestIdOf(req: Request): string {
  return (req.headers['x-request-id'] as string | undefined) ?? `public-signup-${Date.now()}`;
}

function assertIdShape(requestId: string): void {
  if (!CUID_PATTERN.test(requestId)) {
    // 404-shaped, so a probe cannot tell a malformed id from one that simply does not exist.
    throw new HttpException('company_signup_request_not_found', HttpStatus.NOT_FOUND);
  }
}

// Same derivation the system onboarding controller uses for handoff links.
function webAppBase(req: Request): string {
  const origin = req.headers['origin'] as string | undefined;
  if (origin) return origin;
  const proto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0]?.trim() ?? req.protocol ?? 'http';
  const host = (req.headers['x-forwarded-host'] as string | undefined)?.split(',')[0]?.trim() ?? req.get('host') ?? 'localhost:3000';
  return `${proto}://${host}`;
}
