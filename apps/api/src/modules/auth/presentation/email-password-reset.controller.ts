import { Body, Controller, Header, HttpCode, Post, Req } from '@nestjs/common';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';
import type { Request } from 'express';
import { Public } from '../../../common/security/public.decorator';
import { trustedClientIp } from '../../../common/security/trusted-client-ip';
import { RequestPasswordResetUseCase } from '../application/use-cases/request-password-reset.use-case';
import { ConfirmPasswordResetUseCase } from '../application/use-cases/confirm-password-reset.use-case';
import { AuthRateLimitService } from '../application/auth-rate-limit.service';
import { EMAIL_RECOVERY_TOKEN } from '../domain/logic/secure-token.logic';
import { PasswordResetRequestDto } from './auth.controller';

class EmailPasswordResetConfirmDto {
  @IsString() @Matches(EMAIL_RECOVERY_TOKEN) token!:string;
  @IsString() @MinLength(8) @MaxLength(128) newPassword!:string;
}
@Public() @Controller('auth/password')
export class EmailPasswordResetController {
  constructor(private readonly requestReset:RequestPasswordResetUseCase,private readonly confirmReset:ConfirmPasswordResetUseCase,private readonly rateLimit:AuthRateLimitService){}
  @Post('email-reset-request') @HttpCode(200) @Header('Cache-Control','no-store')
  async request(@Body() dto:PasswordResetRequestDto,@Req() req:Request){
    await this.rateLimit.assertPasswordResetRequestAllowed(dto.username.trim().toLowerCase(),trustedClientIp(req));
    return this.requestReset.execute({identifier:dto.username,requestId:req.headers['x-request-id'] as string|undefined});
  }
  @Post('email-reset-confirm') @HttpCode(200) @Header('Cache-Control','no-store')
  async confirm(@Body() dto:EmailPasswordResetConfirmDto,@Req() req:Request){
    await this.rateLimit.assertPasswordResetConfirmAllowed(trustedClientIp(req));
    return this.confirmReset.execute({...dto,requestId:req.headers['x-request-id'] as string|undefined});
  }
}
