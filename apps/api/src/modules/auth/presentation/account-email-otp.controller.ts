import { Body, Controller, Get, Header, HttpCode, Param, Post, Req, UnauthorizedException } from '@nestjs/common';
import { IsBoolean, IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength, Min } from 'class-validator';
import type { Request } from 'express';
import { RequirePermissions } from '../../../common/security/permissions.decorator';
import { trustedClientIp } from '../../../common/security/trusted-client-ip';
import type { RequestContext } from '../domain/models/request-context.model';
import { AccountEmailOtpService } from '../application/account-email-otp.service';
import { AccountEmailReauthService } from '../application/account-email-reauth.service';
import { AuthRateLimitService } from '../application/auth-rate-limit.service';
import { extractSid } from './auth.controller';

export class EmailOtpRequestDto {
  @IsString() @MaxLength(320) newEmail!: string;
  @IsUUID('4') requestKey!: string;
  @IsInt() @Min(0) expectedEmailRevision!: number;
  @IsOptional() @IsString() currentPassword?: string;
}
export class EmailOtpConfirmDto {
  @IsString() @Matches(/^\d{6}$/) code!: string;
}
class EmailLoginEnableDto {
  @IsBoolean() enabled!: boolean;
  @IsOptional() @IsString() currentPassword?: string;
}
class EmailLineReauthDto {
  @IsString() @MaxLength(4096) code!: string;
  @IsString() @Matches(/^[A-Za-z0-9_-]{43,128}$/) codeVerifier!: string;
  @IsString() @Matches(/^[A-Za-z0-9_-]{32,128}$/) nonce!: string;
}
type AccountRequest = Request & { context: RequestContext };
function caller(req: AccountRequest) {
  const tokenId = extractSid(req);
  if (!tokenId) throw new UnauthorizedException('Session is required.');
  return { companyId: req.context.companyId, userId: req.context.userId, tokenId, requestId: req.context.requestId };
}

@Controller('auth/account/email/otp')
export class AccountEmailOtpController {
  constructor(private readonly otp: AccountEmailOtpService, private readonly reauth: AccountEmailReauthService,
    private readonly limits: AuthRateLimitService) {}

  @Get() @RequirePermissions('account.session.read') @Header('Cache-Control', 'no-store')
  status(@Req() req: AccountRequest) { return this.otp.status(req.context.userId); }

  @Get(':id') @RequirePermissions('account.session.read') @Header('Cache-Control', 'no-store')
  challenge(@Param('id') id: string, @Req() req: AccountRequest) { return this.otp.status(req.context.userId, id); }

  @Post('login-method') @HttpCode(200) @RequirePermissions('account.password.change') @Header('Cache-Control', 'no-store')
  async loginMethod(@Body() dto: EmailLoginEnableDto, @Req() req: AccountRequest) {
    await this.limits.assertEmailOtpUserAllowed(req.context.userId);
    return this.otp.setEmailLogin({ ...dto, ...caller(req) });
  }

  @Post('request') @HttpCode(202) @RequirePermissions('account.password.change') @Header('Cache-Control', 'no-store')
  async request(@Body() dto: EmailOtpRequestDto, @Req() req: AccountRequest) {
    await this.limits.assertEmailOtpIpAllowed(trustedClientIp(req));
    await this.limits.assertEmailOtpUserAllowed(req.context.userId);
    return this.otp.request({ ...dto, ...caller(req) });
  }

  @Post(':id/resend') @HttpCode(202) @RequirePermissions('account.password.change') @Header('Cache-Control', 'no-store')
  async resend(@Param('id') id: string, @Body() dto: EmailOtpRequestDto, @Req() req: AccountRequest) {
    await this.limits.assertEmailOtpIpAllowed(trustedClientIp(req));
    await this.limits.assertEmailOtpUserAllowed(req.context.userId);
    return this.otp.resend({ ...dto, ...caller(req), challengeId: id });
  }

  @Post(':id/confirm') @HttpCode(200) @RequirePermissions('account.password.change') @Header('Cache-Control', 'no-store')
  async confirm(@Param('id') id: string, @Body() dto: EmailOtpConfirmDto, @Req() req: AccountRequest) {
    await this.limits.assertEmailOtpIpAllowed(trustedClientIp(req));
    return this.otp.confirm({ ...caller(req), challengeId: id, code: dto.code });
  }

  @Post(':id/cancel') @HttpCode(200) @RequirePermissions('account.password.change') @Header('Cache-Control', 'no-store')
  cancel(@Param('id') id: string, @Req() req: AccountRequest) { return this.otp.cancel({ ...caller(req), challengeId: id }); }

  @Post('line-reauth/start') @HttpCode(200) @RequirePermissions('account.password.change') @Header('Cache-Control', 'no-store')
  async beginLine(@Req() req: AccountRequest) {
    await this.limits.assertLineLoginCallbackAllowed(trustedClientIp(req));
    return this.reauth.begin(caller(req));
  }

  @Post('line-reauth') @HttpCode(200) @RequirePermissions('account.password.change') @Header('Cache-Control', 'no-store')
  async line(@Body() dto: EmailLineReauthDto, @Req() req: AccountRequest) {
    await this.limits.assertLineLoginCallbackAllowed(trustedClientIp(req));
    return this.reauth.execute({ ...dto, ...caller(req) });
  }
}
