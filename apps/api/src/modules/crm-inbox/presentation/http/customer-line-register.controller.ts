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
  LIFF_PAGE_CSP,
  liffPageHtml,
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
    const companyName = company ? company.brandName ?? company.name : 'มั่งมีพลัส';
    // Same builder as the other four LIFF pages, so this one inherits the มั่งมี theme, the message
    // tones and the "an empty container paints nothing" rule instead of carrying a stale copy of an
    // older stylesheet. Headers, CSP, ids and copy are all unchanged (review SHOULD-FIX 3).
    return liffPageHtml({
      title: `${companyName} LINE Customer Registration`,
      data: {
        'liff-mode': 'customer',
        'liff-id': liffId,
        'api-base': apiBase,
      },
      // The consent notice is long-form legal text, so it opts out of the shared `pre` rule: reading
      // size and reading colour, in the page's own face rather than monospace.
      style: 'label{display:flex;gap:8px;align-items:flex-start;margin:12px 0}'
        + '\n    #consent{width:22px;height:22px;min-height:0;flex:none}'
        // dvh, not vh: on a phone browser vh ignores the collapsing address bar (project rule).
        + '\n    .consent-notice{font-family:inherit;font-size:14px;color:var(--ink);max-height:40dvh;overflow-y:auto}',
      content: `      <h1>ลงทะเบียนลูกค้า LINE — ${escapeHtml(companyName)}</h1>
      <pre class="consent-notice">${escapeHtml(PDPA_CONSENT_NOTICE_TEXT)}</pre>
      <label><input id="consent" type="checkbox" required /> <span>ยินยอมตามประกาศความเป็นส่วนตัวนี้</span></label>
      <p id="status" class="notice notice-info">Ready</p>
      <button id="register">Register</button>
      <pre id="detail"></pre>`,
    });
  }
}
