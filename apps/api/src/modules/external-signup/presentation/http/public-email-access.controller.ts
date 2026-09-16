import { Body, Controller, Header, HttpCode, Post, Req } from '@nestjs/common';
import { IsEmail, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';
import type { Request } from 'express';
import { randomUUID } from 'node:crypto';
import { Public } from '../../../../common/security/public.decorator';
import { trustedClientIp } from '../../../../common/security/trusted-client-ip';
import { requiredWebAppBase, trustedPublicApiBase } from '../../../../common/http/public-api-base';
import { AppConfigService } from '../../../../common/config/app-config.service';
import { EmailAccessService } from '../../../auth/application/email-access.service';
import { AuthRateLimitService } from '../../../auth/application/auth-rate-limit.service';
import { EmailSignupService } from '../../application/email-signup.service';

class EmailAccessRequestDto {
  @IsEmail() @MaxLength(254) email!: string;
  @IsUUID() requestKey!: string;
  @IsString() @Matches(/^[A-Za-z0-9_-]{43}$/) browserSecret!: string;
}
class EmailProofDto {
  @IsUUID() challengeId!: string;
  @IsString() @Matches(/^[A-Za-z0-9_-]{43}$/) browserSecret!: string;
}
class EmailAccessConfirmDto extends EmailProofDto {
  @IsString() @Matches(/^\d{6}$/) code!: string;
}
class EmailSignupDto extends EmailProofDto {
  @IsString() @MinLength(1) @MaxLength(120) companyName!: string;
  @IsString() @MinLength(1) @MaxLength(160) displayName!: string;
  @IsString() @Matches(/^(?:0|\+66)[0-9 -]{8,14}$/) phoneNumber!: string;
  @IsString() @Matches(/^EMAIL_SIGNUP_V1$/) consentVersion!: string;
}
@Public()
@Controller('public/email-access')
export class PublicEmailAccessController {
  constructor(private readonly access: EmailAccessService, private readonly signup: EmailSignupService,
    private readonly rate: AuthRateLimitService, private readonly config: AppConfigService) {}
  @Post('request') @HttpCode(200) @Header('Cache-Control', 'no-store')
  async request(@Body() dto: EmailAccessRequestDto, @Req() req: Request) {
    await this.rate.assertEmailAccessAllowed(trustedClientIp(req), 'request');
    return this.access.request({ ...dto, requestId: requestId(req) });
  }
  @Post('confirm') @HttpCode(200) @Header('Cache-Control', 'no-store')
  async confirm(@Body() dto: EmailAccessConfirmDto, @Req() req: Request) {
    await this.rate.assertEmailAccessAllowed(trustedClientIp(req), 'confirm');
    return this.access.confirm({ ...dto, requestId: requestId(req) });
  }
  @Post('signup') @HttpCode(200) @Header('Cache-Control', 'no-store')
  async create(@Body() dto: EmailSignupDto, @Req() req: Request) {
    await this.rate.assertEmailAccessAllowed(trustedClientIp(req), 'signup');
    return this.signup.submit({ ...dto, requestId: requestId(req) }, this.urls(req));
  }
  @Post('status') @HttpCode(200) @Header('Cache-Control', 'no-store')
  async status(@Body() dto: EmailProofDto, @Req() req: Request) {
    await this.rate.assertEmailAccessAllowed(trustedClientIp(req), 'signup');
    const proof = await this.access.inspect(dto);
    return proof.kind === 'SIGNUP' ? this.signup.status({ ...dto, requestId: requestId(req) }, this.urls(req)) : proof;
  }
  private urls(req: Request) {
    const webBaseUrl = requiredWebAppBase(this.config.sesWebBaseUrl);
    return { webBaseUrl, apiBaseUrl: trustedPublicApiBase(req) };
  }
}
function requestId(req: Request) { return typeof req.headers['x-request-id'] === 'string' ? req.headers['x-request-id'] : randomUUID(); }
