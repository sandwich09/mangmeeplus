import { Body, Controller, Get, Header, HttpCode, Post, Req } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';
import type { Request } from 'express';
import { AppConfigService } from '../../../../common/config/app-config.service';
import { publicApiBase } from '../../../../common/http/public-api-base';
import { Public } from '../../../../common/security/public.decorator';
import { trustedClientIp } from '../../../../common/security/trusted-client-ip';
import {
  escapeHtml,
  LIFF_CLIENT_NOTICE_HTML,
  LIFF_PAGE_CSP,
  LINE_CHANNEL_ID_PATTERN,
  LINE_ID_TOKEN_MAX_LENGTH,
  LINE_ID_TOKEN_PATTERN,
  validLineChannelId,
} from '../../../../common/security/liff-page.security';
import { AuthRateLimitService } from '../../../auth/application/auth-rate-limit.service';
import { CustomerLineRegisterUseCase } from '../../application/use-cases/customer-line-register.use-case';
import { PDPA_CONSENT_NOTICE_TEXT } from '../../domain/crm-inbox.constants';
import { CrmAiContextRepository } from '../../infrastructure/crm-ai-context.repository';
import { PrismaCrmInboxRepository } from '../../infrastructure/prisma-crm-inbox.repository';

export class CustomerLineRegisterDto {
  @IsString() @IsNotEmpty() @MaxLength(LINE_ID_TOKEN_MAX_LENGTH) @Matches(LINE_ID_TOKEN_PATTERN) idToken!: string;
  @IsString() @IsNotEmpty() @MaxLength(128) @Matches(LINE_CHANNEL_ID_PATTERN) lineChannelId!: string;
  @IsBoolean() consent!: boolean;
}

@Controller('auth')
export class CustomerLineRegisterController {
  constructor(
    private readonly config: AppConfigService,
    private readonly rateLimit: AuthRateLimitService,
    private readonly register: CustomerLineRegisterUseCase,
    private readonly inboxRepo: PrismaCrmInboxRepository,
    private readonly aiContext: CrmAiContextRepository,
  ) {}

  @Public()
  @Post('line/customer-register')
  @HttpCode(200)
  @ApiOperation({ summary: 'Customer LINE LIFF self-registration' })
  @ApiBody({ type: CustomerLineRegisterDto })
  @ApiResponse({ status: 200, description: 'Customer registered or linked' })
  @ApiResponse({ status: 400, description: 'Consent required' })
  @ApiResponse({ status: 404, description: 'Unknown or disabled channel' })
  async customerRegister(@Body() dto: CustomerLineRegisterDto, @Req() req: Request) {
    const ip = trustedClientIp(req);
    await this.rateLimit.assertCustomerRegisterAllowed(ip, dto.lineChannelId);
    return this.register.execute({
      idToken: dto.idToken,
      lineChannelId: dto.lineChannelId,
      consentGranted: dto.consent,
      ipAddress: ip,
      requestId: (req.headers['x-request-id'] as string | undefined) ?? undefined,
    });
  }

  @Public()
  @Get('line/customer-register-page')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store, max-age=0')
  @Header('Referrer-Policy', 'no-referrer')
  @Header('Content-Security-Policy', LIFF_PAGE_CSP)
  @ApiOperation({ summary: 'Customer LINE LIFF self-registration page' })
  async customerRegisterPage(@Req() req: Request): Promise<string> {
    const liffId = this.config.lineLiffId ?? '';
    const apiBase = publicApiBase(req);
    const lineChannelId = validLineChannelId(new URLSearchParams(req.url.split('?')[1] ?? '').get('lineChannelId'));
    const channel = lineChannelId ? await this.inboxRepo.findActiveChannelByLineChannelId(lineChannelId) : null;
    const company = channel ? await this.aiContext.findCompany(channel.companyId) : null;
    const companyDisplayName = escapeHtml(company ? company.brandName ?? company.name : 'มั่งมีพลัส');
    return `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${companyDisplayName} LINE Customer Registration</title>
  <style>
    body{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:0;padding:24px;line-height:1.5;color:#111827;background:#f9fafb}
    main{max-width:560px;margin:auto;background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:20px}
    button,a.btn{border:0;border-radius:6px;background:#16a34a;color:white;padding:10px 14px;font-weight:600;display:inline-block;text-decoration:none}
    [hidden]{display:none!important}
    button:disabled{opacity:.5}
    pre{white-space:pre-wrap;background:#f3f4f6;border-radius:6px;padding:12px}
    label{display:flex;gap:8px;align-items:flex-start;margin:12px 0}
  </style>
</head>
<body data-liff-mode="customer" data-liff-id="${escapeHtml(liffId)}" data-api-base="${escapeHtml(apiBase)}">
  <main>
    ${LIFF_CLIENT_NOTICE_HTML}
    <div id="liff-content">
      <h1>ลงทะเบียนลูกค้า LINE — ${companyDisplayName}</h1>
      <pre>${escapeHtml(PDPA_CONSENT_NOTICE_TEXT)}</pre>
      <label><input id="consent" type="checkbox" required /> <span>ยินยอมตามประกาศความเป็นส่วนตัวนี้</span></label>
      <p id="status">Ready</p>
      <button id="register">Register</button>
      <pre id="detail"></pre>
    </div>
  </main>
  <script src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script>
  <script src="/v1/auth/line/link-page.js"></script>
</body>
</html>`;
  }
}
