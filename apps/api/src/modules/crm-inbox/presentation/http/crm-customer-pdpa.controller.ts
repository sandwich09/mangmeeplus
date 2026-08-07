import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import { Public } from '../../../../common/security/public.decorator';
import { trustedClientIp } from '../../../../common/security/trusted-client-ip';
import {
  LINE_CHANNEL_ID_PATTERN,
  LINE_ID_TOKEN_MAX_LENGTH,
  LINE_ID_TOKEN_PATTERN,
} from '../../../../common/security/liff-page.security';
import { AuthRateLimitService } from '../../../auth/application/auth-rate-limit.service';
import { CrmCustomerSelfServiceUseCase } from '../../application/use-cases/crm-pdpa.use-case';

class CrmCustomerPdpaDto {
  @IsString() @IsNotEmpty() @MaxLength(LINE_ID_TOKEN_MAX_LENGTH) @Matches(LINE_ID_TOKEN_PATTERN) idToken!: string;
  @IsString() @IsNotEmpty() @MaxLength(128) @Matches(LINE_CHANNEL_ID_PATTERN) lineChannelId!: string;
}

class CrmCustomerErasureDto extends CrmCustomerPdpaDto {
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

class CrmCustomerDataExportDto extends CrmCustomerPdpaDto {
  @IsOptional() @IsString() @MaxLength(512) conversationCursor?: string;
  @IsOptional() @IsString() @MaxLength(512) messageCursor?: string;
  @IsOptional() @IsString() @MaxLength(512) bookingCursor?: string;
  @IsOptional() @IsInt() @Min(1) @Max(500) limit?: number;
}

class CrmCustomerErasureStatusDto extends CrmCustomerPdpaDto {
  @IsString() @IsNotEmpty() @MaxLength(128) caseId!: string;
}

/**
 * CUST-08 customer self-service PDPA requests. All endpoints are @Public but the
 * caller is authenticated per-request by a LIFF-verified LINE id token inside the
 * use-case (mirrors CustomerLineRegisterController). The register rate-limit budget
 * is reused as anti-abuse defense-in-depth on top of that verification.
 */
@Controller('crm-customer/pdpa')
export class CrmCustomerPdpaController {
  constructor(
    private readonly rateLimit: AuthRateLimitService,
    private readonly selfService: CrmCustomerSelfServiceUseCase,
  ) {}

  private requestId(req: Request): string {
    return (req.headers['x-request-id'] as string | undefined) ?? randomUUID();
  }

  @Public()
  @Post('consent-withdraw')
  @HttpCode(200)
  @ApiOperation({ summary: 'Customer LINE LIFF self-service consent withdrawal' })
  @ApiBody({ type: CrmCustomerDataExportDto })
  @ApiResponse({ status: 200, description: 'Consent revoked' })
  @ApiResponse({ status: 401, description: 'Identity not verified' })
  @ApiResponse({ status: 404, description: 'Unknown channel or customer' })
  async consentWithdraw(@Body() dto: CrmCustomerPdpaDto, @Req() req: Request) {
    const ip = trustedClientIp(req);
    await this.rateLimit.assertCustomerRegisterAllowed(ip, dto.lineChannelId);
    return this.selfService.withdrawConsent({ idToken: dto.idToken, lineChannelId: dto.lineChannelId, requestId: this.requestId(req), ipAddress: ip });
  }

  @Public()
  @Post('data-export')
  @HttpCode(200)
  @ApiOperation({ summary: 'Customer LINE LIFF self-service data export' })
  @ApiBody({ type: CrmCustomerPdpaDto })
  @ApiResponse({ status: 200, description: 'Customer-visible data export' })
  @ApiResponse({ status: 401, description: 'Identity not verified' })
  @ApiResponse({ status: 404, description: 'Unknown channel or customer' })
  async dataExport(@Body() dto: CrmCustomerDataExportDto, @Req() req: Request) {
    const ip = trustedClientIp(req);
    await this.rateLimit.assertCustomerRegisterAllowed(ip, dto.lineChannelId);
    return this.selfService.exportData({
      idToken: dto.idToken,
      lineChannelId: dto.lineChannelId,
      requestId: this.requestId(req),
      ipAddress: ip,
      page: {
        conversationCursor: dto.conversationCursor,
        messageCursor: dto.messageCursor,
        bookingCursor: dto.bookingCursor,
        limit: dto.limit,
      },
    });
  }

  @Public()
  @Post('erasure-request')
  @HttpCode(202)
  @ApiOperation({ summary: 'Customer LINE LIFF self-service erasure request' })
  @ApiBody({ type: CrmCustomerErasureDto })
  @ApiResponse({ status: 202, description: 'Erasure request recorded' })
  @ApiResponse({ status: 401, description: 'Identity not verified' })
  @ApiResponse({ status: 404, description: 'Unknown channel or customer' })
  async erasureRequest(@Body() dto: CrmCustomerErasureDto, @Req() req: Request) {
    const ip = trustedClientIp(req);
    await this.rateLimit.assertCustomerRegisterAllowed(ip, dto.lineChannelId);
    return this.selfService.requestErasure({ idToken: dto.idToken, lineChannelId: dto.lineChannelId, reason: dto.reason, requestId: this.requestId(req), ipAddress: ip });
  }

  @Public()
  @Post('erasure-status')
  @HttpCode(200)
  @ApiOperation({ summary: 'Customer LINE LIFF self-service erasure request status' })
  @ApiBody({ type: CrmCustomerErasureStatusDto })
  @ApiResponse({ status: 200, description: 'Durable erasure request status' })
  async erasureStatus(@Body() dto: CrmCustomerErasureStatusDto, @Req() req: Request) {
    const ip = trustedClientIp(req);
    await this.rateLimit.assertCustomerRegisterAllowed(ip, dto.lineChannelId);
    return this.selfService.getErasureStatus({
      idToken: dto.idToken,
      lineChannelId: dto.lineChannelId,
      caseId: dto.caseId,
      requestId: this.requestId(req),
      ipAddress: ip,
    });
  }
}
