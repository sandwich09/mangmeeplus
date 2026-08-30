import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  ForbiddenException,
  Logger,
  NotFoundException,
  Optional,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Equals, IsBoolean, IsEmail, IsNotEmpty, IsOptional, IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';
import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import { Public } from '../../../common/security/public.decorator';
import { trustedClientIp } from '../../../common/security/trusted-client-ip';
import {
  COMPANY_ID_PATTERN,
  EMPLOYEE_LINE_LINK_TOKEN_PATTERN,
  escapeHtml,
  LIFF_CLIENT_NOTICE_HTML,
  LIFF_PAGE_CSP,
  LIFF_PAGE_SCRIPT,
  LINE_CHANNEL_ID_PATTERN,
  LINE_ID_TOKEN_MAX_LENGTH,
  LINE_ID_TOKEN_PATTERN,
} from '../../../common/security/liff-page.security';
import { accessTokenFromCookies } from './auth-cookie.constants';
import { publicApiBase } from '../../../common/http/public-api-base';
import { RequirePermissions } from '../../../common/security/permissions.decorator';
import { AppConfigService } from '../../../common/config/app-config.service';
import { emitSecurityEvent, SECURITY_EVENT } from '../../../common/logger/security-event';
import { PrismaService } from '../../../common/database/prisma.service';
import { IssueTokenUseCase } from '../application/use-cases/issue-token.use-case';
import { ExchangeLineTokenUseCase } from '../application/use-cases/exchange-line-token.use-case';
import { LineLoginCallbackUseCase } from '../application/use-cases/line-login-callback.use-case';
import { LineLinkOauthUseCase } from '../application/use-cases/line-link-oauth.use-case';
import { CreateLineWebLoginTransactionUseCase } from '../application/use-cases/create-line-web-login-transaction.use-case';
import { ApproveLineWebLoginTransactionUseCase } from '../application/use-cases/approve-line-web-login-transaction.use-case';
import { RedeemLineWebLoginTransactionUseCase } from '../application/use-cases/redeem-line-web-login-transaction.use-case';
import { ExchangeLineHandoffTokenUseCase } from '../application/use-cases/exchange-line-handoff-token.use-case';
import { RefreshSessionUseCase } from '../application/use-cases/refresh-session.use-case';
import { LogoutUseCase } from '../application/use-cases/logout.use-case';
import { RevokeOtherSessionsUseCase } from '../application/use-cases/revoke-other-sessions.use-case';
import { LinkLineIdentityUseCase } from '../application/use-cases/link-line-identity.use-case';
import { UnlinkLineIdentityUseCase } from '../application/use-cases/unlink-line-identity.use-case';
import { PasswordLoginUseCase } from '../application/use-cases/password-login.use-case';
import { ChangePasswordUseCase } from '../application/use-cases/change-password.use-case';
import { CompleteEmployeeLineLinkUseCase } from '../application/use-cases/complete-employee-line-link.use-case';
import { NotifyPasswordResetRequestUseCase } from '../application/use-cases/notify-password-reset-request.use-case';
import { GetAccountSecurityStateUseCase } from '../application/use-cases/get-account-security-state.use-case';
import { SetAiAssistantPreferenceUseCase } from '../application/use-cases/set-ai-assistant-preference.use-case';
import { RequestEmailChangeUseCase } from '../application/use-cases/request-email-change.use-case';
import { ResendEmailVerificationUseCase } from '../application/use-cases/resend-email-verification.use-case';
import { ConfirmEmailVerificationUseCase } from '../application/use-cases/confirm-email-verification.use-case';
import { AuthRateLimitService } from '../application/auth-rate-limit.service';
import { AuditService } from '../../audit/application/audit.service';
import { AuditAction } from '../../audit/domain/models/audit-action';
import type { RequestContext } from '../domain/models/request-context.model';
import { loginChannelAvailability } from '../domain/logic/login-channel.logic';
import { LegalAcceptanceService } from '../application/legal-acceptance.service';
import type { AcceptLegalDocumentsInput } from '@watchdog-bms/contracts';

export class EmployeeLineLinkDto {
  @IsString() @Length(32, 32) @Matches(EMPLOYEE_LINE_LINK_TOKEN_PATTERN) token!: string;
  @IsString() @IsNotEmpty() @MaxLength(LINE_ID_TOKEN_MAX_LENGTH) @Matches(LINE_ID_TOKEN_PATTERN) idToken!: string;
}

export class LineExchangeDto {
  @IsString() @IsNotEmpty() @MaxLength(LINE_ID_TOKEN_MAX_LENGTH) @Matches(LINE_ID_TOKEN_PATTERN) idToken!: string;
  @IsString() @IsNotEmpty() @MaxLength(128) @Matches(LINE_CHANNEL_ID_PATTERN) channelId!: string;
}

class LineLoginCallbackDto {
  @IsString() @Matches(/^[\w.-]{10,512}$/) code!: string;
  @IsString() @Matches(/^[A-Za-z0-9\-._~]{43,128}$/) codeVerifier!: string;
  @IsString() @Matches(/^[A-Za-z0-9_-]{16,256}$/) nonce!: string;
}

// P12-3a: both halves are 24 random bytes rendered base64url; the bound keeps a hostile body from
// reaching the hash function with something the size of a payload.
const LINE_QR_CREDENTIAL_PATTERN = /^[A-Za-z0-9_-]{20,128}$/;

class LineQrCreateDto {
  @IsString() @IsOptional() @MaxLength(512) returnTo?: string;
}

class LineQrRedeemDto {
  @IsString() @Matches(LINE_QR_CREDENTIAL_PATTERN) desktopSecret!: string;
}

class LineQrApproveDto {
  @IsString() @Matches(LINE_QR_CREDENTIAL_PATTERN) publicCode!: string;
}

/** P12-3b: 24 bytes base64url is 32 characters; the range tolerates a future TTL/size change
 *  without loosening the alphabet, and anything outside it is refused before a query runs. */
class LineHandoffExchangeDto {
  @IsString() @Matches(/^[A-Za-z0-9_-]{20,128}$/) token!: string;
}

export class LineLinkDto {
  @IsString() @IsNotEmpty() @MaxLength(LINE_ID_TOKEN_MAX_LENGTH) @Matches(LINE_ID_TOKEN_PATTERN) idToken!: string;
  @IsString() @IsOptional() @MaxLength(128) @Matches(COMPANY_ID_PATTERN) companyId?: string;
}

class RefreshDto {
  @IsString() @IsNotEmpty() refreshToken!: string;
}

class DevTokenDto {
  @IsString() @IsOptional() userId?: string;
}

class PasswordLoginDto {
  @IsString() @IsNotEmpty() username!: string;
  @IsString() @IsNotEmpty() password!: string;
}

class ChangePasswordDto {
  @IsString() @IsNotEmpty() currentPassword!: string;
  @IsString() @MinLength(8) newPassword!: string;
}

class SetAiAssistantPreferenceDto {
  @IsBoolean() enabled!: boolean;
}

export class AcceptLegalDocumentsDto implements AcceptLegalDocumentsInput {
  @IsString() @IsNotEmpty() termsVersion!: string;
  @IsString() @IsNotEmpty() privacyVersion!: string;
  @IsString() @IsNotEmpty() statementVersion!: string;
  @Equals(true) termsAccepted!: true;
  @Equals(true) privacyAcknowledged!: true;
  @Equals(true) deletionAcknowledged!: true;
  // The current immutable artifacts are Thai-only. English must ship as its own
  // versioned/fingerprinted release before this boundary may accept `en`.
  @Equals('th') locale!: 'th';
  @IsString() @Length(64, 64) @MaxLength(64) @Matches(/^[a-f0-9]{64}$/) displayChallenge!: string;
}

export class PasswordResetRequestDto {
  @IsString() @IsNotEmpty() @MaxLength(64) username!: string;
}

class RequestEmailChangeDto {
  @IsString() @IsNotEmpty() currentPassword!: string;
  @IsEmail() @MaxLength(320) newEmail!: string;
}

class VerifyEmailDto {
  @IsString() @IsNotEmpty() token!: string;
}

function extractSidFromToken(token: string | undefined): string | undefined {
  if (!token) return undefined;
  try {
    const [, part] = token.split('.');
    const decoded = JSON.parse(Buffer.from(part!, 'base64url').toString()) as Record<string, unknown>;
    return typeof decoded['sid'] === 'string' ? decoded['sid'] : undefined;
  } catch { return undefined; }
}

// ponytail: Bearer header is primary; watchdog_token cookie covers the web BFF session
function extractSid(req: Request): string | undefined {
  const bearerHeader = req.headers['authorization'] as string | undefined;
  const headerToken = bearerHeader?.startsWith('Bearer ') ? bearerHeader.slice(7) : undefined;
  const cookieToken = accessTokenFromCookies((req as Record<string, any>)['cookies']);
  return extractSidFromToken(headerToken ?? cookieToken);
}

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly config: AppConfigService,
    private readonly prisma: PrismaService,
    private readonly issueToken: IssueTokenUseCase,
    private readonly exchangeLineToken: ExchangeLineTokenUseCase,
    private readonly refreshSession: RefreshSessionUseCase,
    private readonly logout: LogoutUseCase,
    private readonly revokeOtherSessions: RevokeOtherSessionsUseCase,
    private readonly linkLineIdentity: LinkLineIdentityUseCase,
    private readonly unlinkLineIdentity: UnlinkLineIdentityUseCase,
    private readonly passwordLogin: PasswordLoginUseCase,
    private readonly changePassword: ChangePasswordUseCase,
    private readonly completeEmployeeLineLink: CompleteEmployeeLineLinkUseCase,
    private readonly notifyPasswordResetRequest: NotifyPasswordResetRequestUseCase,
    private readonly getAccountSecurityState: GetAccountSecurityStateUseCase,
    private readonly setAiAssistantPreferenceUseCase: SetAiAssistantPreferenceUseCase,
    private readonly requestEmailChange: RequestEmailChangeUseCase,
    private readonly resendEmailVerification: ResendEmailVerificationUseCase,
    private readonly confirmEmailVerification: ConfirmEmailVerificationUseCase,
    private readonly authRateLimit: AuthRateLimitService,
    private readonly legalAcceptance: LegalAcceptanceService,
    private readonly lineLoginCallbackUseCase: LineLoginCallbackUseCase,
    private readonly lineLinkOauthUseCase: LineLinkOauthUseCase,
    private readonly createLineWebLoginTransaction: CreateLineWebLoginTransactionUseCase,
    private readonly approveLineWebLoginTransaction: ApproveLineWebLoginTransactionUseCase,
    private readonly redeemLineWebLoginTransaction: RedeemLineWebLoginTransactionUseCase,
    private readonly exchangeLineHandoffToken: ExchangeLineHandoffTokenUseCase,
    @Optional() @Inject(AuditService) private readonly audit: AuditService | null = null,
  ) {}

  @Public()
  @Get('login-channels')
  @ApiOperation({ summary: 'Discover configured login channels; unavailable channels fail closed' })
  loginChannels() {
    return loginChannelAvailability(this.config);
  }

  @Public()
  @Post('password/login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Sign in with an admin-created username and password' })
  @ApiBody({ type: PasswordLoginDto })
  @ApiResponse({ status: 200, description: 'Tokens issued' })
  @ApiResponse({ status: 401, description: 'Invalid username or password' })
  @ApiResponse({ status: 429, description: 'Too many failed attempts for this account or IP' })
  async passwordLoginWithCredentials(@Body() dto: PasswordLoginDto, @Req() req: Request) {
    const ip = trustedClientIp(req);
    const requestId = (req.headers['x-request-id'] as string | undefined) ?? randomUUID();
    try {
      await this.authRateLimit.assertPasswordLoginAllowed(dto.username, ip);
      return await this.passwordLogin.execute(dto.username, dto.password);
    } catch (error) {
      const rateLimited = error instanceof HttpException && error.getStatus() === HttpStatus.TOO_MANY_REQUESTS;
      if (error instanceof UnauthorizedException) {
        await this.authRateLimit.recordPasswordLoginFailure(dto.username, ip);
      }
      if (rateLimited || error instanceof UnauthorizedException) {
        const reason = rateLimited ? 'rate_limited' : 'invalid_credentials';
        // L-14: a CloudWatch metric filter cannot see a Postgres row, so the denial is
        // mirrored into the log stream under a stable dotted name.
        emitSecurityEvent(this.logger, SECURITY_EVENT.authLoginDenied, 'HIGH', { reason, requestId });
        // L-10: awaited like the rest of the session-auth events — a denied login is the row
        // brute-force investigation reads, so it must not be fire-and-forget. Post-commit
        // AuditService.log never throws, so a failed audit cannot turn this 401 into a 500.
        await this.audit?.log({
          action: AuditAction.AUTH_LOGIN_DENIED,
          targetType: 'user',
          requestId,
          result: 'DENIED',
          riskLevel: 'MEDIUM',
          metadataJson: { identifier: dto.username, reason },
        });
      }
      throw error;
    }
  }

  @Public()
  @Post('password/reset-request')
  @HttpCode(200)
  @ApiOperation({ summary: 'Send a one-time recovery password to the account\'s linked LINE identity' })
  @ApiBody({ type: PasswordResetRequestDto })
  @ApiResponse({ status: 200, description: 'Generic response returned for all requests' })
  @ApiResponse({ status: 429, description: 'Too many reset requests for this account or IP' })
  async requestPasswordResetNotice(@Body() dto: PasswordResetRequestDto, @Req() req: Request) {
    // L-06: the bucket key is normalized exactly like the lookup, so `alice`, `Alice` and
    // `ALICE` share one quota instead of multiplying it by case permutations.
    const identifier = dto.username.trim().toLowerCase();
    await this.authRateLimit.assertPasswordResetRequestAllowed(identifier, trustedClientIp(req));
    return this.notifyPasswordResetRequest.execute({
      username: dto.username,
      requestId: (req.headers['x-request-id'] as string | undefined) ?? randomUUID(),
    });
  }

  @Public()
  @Post('dev/token')
  @HttpCode(200)
  @ApiOperation({ summary: 'Issue dev token (local only)' })
  @ApiBody({ type: DevTokenDto })
  @ApiResponse({ status: 200, description: 'Tokens issued' })
  @ApiResponse({ status: 404, description: 'Not found in non-local env or no seed data' })
  async devToken(@Body() dto: DevTokenDto) {
    if (!this.config.isLocal) throw new NotFoundException();

    if (dto.userId) {
      const membership = await this.prisma.client.companyMembership.findFirst({
        where: {
          userId: dto.userId,
          status: 'ACTIVE',
          company: { status: 'ACTIVE' },
        },
      });

      if (!membership) {
        throw new NotFoundException('No active membership found for dev user.');
      }

      return this.issueToken.execute(dto.userId, 'dev');
    }

    const membership = await this.prisma.client.companyMembership.findFirst({
      where: {
        status: 'ACTIVE',
        roles: { some: { role: { key: 'OWNER' } } },
      },
      include: { user: true },
      // Oldest membership = the seeded owner; without this, findFirst is heap-order
      // nondeterministic and can mint a token for an e2e-created owner of another company.
      orderBy: { createdAt: 'asc' },
    });

    if (!membership) {
      throw new NotFoundException('No OWNER membership found. Run seed first.');
    }

    return this.issueToken.execute(membership.userId, 'dev');
  }

  @Public()
  @Post('line/exchange')
  @HttpCode(200)
  @ApiOperation({ summary: 'Exchange LINE Login ID token for WatchDog access token' })
  @ApiBody({ type: LineExchangeDto })
  @ApiResponse({ status: 200, description: 'Tokens issued or link-required message' })
  async lineExchange(@Body() dto: LineExchangeDto) {
    // LINE QR login is deferred. Keep this public endpoint fail-closed even if a caller
    // bypasses the hidden login control; employee/account LINE linking is a separate flow.
    void dto;
    throw new ForbiddenException('LINE login is deferred to a future release');
  }

  @Public()
  @Post('line/login/callback')
  @HttpCode(200)
  @ApiOperation({ summary: 'Complete LINE web login: exchange OAuth code, verify ID token, issue first-party tokens' })
  @ApiBody({ type: LineLoginCallbackDto })
  @ApiResponse({ status: 200, description: 'Tokens issued or link-required result' })
  async lineLoginCallback(@Body() dto: LineLoginCallbackDto, @Req() req: Request) {
    if (!this.config.lineWebLoginEnabled) {
      throw new ForbiddenException('LINE login is not enabled.');
    }
    await this.authRateLimit.assertLineLoginCallbackAllowed(trustedClientIp(req));
    return this.lineLoginCallbackUseCase.execute({ code: dto.code, codeVerifier: dto.codeVerifier, nonce: dto.nonce });
  }

  // ---- P12-3a desktop QR login (master plan §13.6E) ----
  // The QR carries a short-TTL single-use transaction, never the OA add-friend QR and never a
  // static code (AUTH-03). Scanning only opens the approve page; the phone still authenticates
  // through the untouched P12-1/P12-2 flow, and only an explicit tap approves.

  @Public()
  @Post('line/qr/create')
  @HttpCode(200)
  @ApiOperation({ summary: 'Mint a desktop QR login transaction; returns the QR and the browser-bound secret' })
  @ApiBody({ type: LineQrCreateDto })
  @ApiResponse({ status: 200, description: 'Transaction created' })
  async lineQrCreate(@Body() dto: LineQrCreateDto, @Req() req: Request) {
    if (!this.config.lineWebLoginEnabled) {
      throw new ForbiddenException('LINE login is not enabled.');
    }
    await this.authRateLimit.assertLineQrCreateAllowed(trustedClientIp(req));
    return this.createLineWebLoginTransaction.execute({ ...(dto.returnTo ? { returnTo: dto.returnTo } : {}) });
  }

  @Public()
  @Post('line/qr/redeem')
  @HttpCode(200)
  @ApiOperation({ summary: 'Poll a desktop QR transaction; issues first-party tokens once approved' })
  @ApiBody({ type: LineQrRedeemDto })
  @ApiResponse({ status: 200, description: 'pending | expired | approved with tokens' })
  @ApiResponse({ status: 403, description: 'Unknown desktop secret or inactive account' })
  async lineQrRedeem(@Body() dto: LineQrRedeemDto, @Req() req: Request) {
    if (!this.config.lineWebLoginEnabled) {
      throw new ForbiddenException('LINE login is not enabled.');
    }
    await this.authRateLimit.assertLineQrPollAllowed(trustedClientIp(req));
    return this.redeemLineWebLoginTransaction.execute({ desktopSecret: dto.desktopSecret });
  }

  // Authenticated on purpose: approving is what binds *this* signed-in user to the desktop's
  // transaction, so it can never be a public endpoint.
  @Post('line/qr/approve')
  @HttpCode(200)
  @ApiOperation({ summary: 'Approve a scanned desktop QR login for the current user' })
  @ApiBody({ type: LineQrApproveDto })
  @ApiResponse({ status: 200, description: 'Transaction approved' })
  @ApiResponse({ status: 404, description: 'QR transaction is expired or not found' })
  async lineQrApprove(@Body() dto: LineQrApproveDto, @Req() req: Request & { context: RequestContext }) {
    if (!this.config.lineWebLoginEnabled) {
      throw new ForbiddenException('LINE login is not enabled.');
    }
    return this.approveLineWebLoginTransaction.execute({
      userId: req.context.userId,
      publicCode: dto.publicCode,
      requestId: req.context.requestId,
    });
  }

  // ---- P12-3b LINE → web deep-link session handoff (spec §11) ----
  // Public because that is the point: the token is the only credential and the browser opening the
  // link may hold no session, or another person's. Deliberately NOT added to CLOSED_PUBLIC_PATHS —
  // while platform access is CLOSED the exchange must fail closed like every other non-public route
  // and land the user on /maintenance (spec §14).
  @Public()
  @Post('line/handoff/exchange')
  @HttpCode(200)
  @ApiOperation({ summary: 'Exchange a single-use LINE deep-link handoff token for a first-party session' })
  @ApiBody({ type: LineHandoffExchangeDto })
  @ApiResponse({ status: 200, description: 'Tokens issued, with the bound company and target path' })
  @ApiResponse({ status: 403, description: 'Expired, used, unknown, or no longer authorised' })
  @ApiResponse({ status: 429, description: 'Too many exchange attempts from this IP' })
  async lineHandoffExchange(@Body() dto: LineHandoffExchangeDto, @Req() req: Request) {
    if (!this.config.lineWebHandoffEnabled) {
      throw new ForbiddenException('LINE login is not enabled.');
    }
    await this.authRateLimit.assertLineHandoffExchangeAllowed(trustedClientIp(req));
    return this.exchangeLineHandoffToken.execute({ token: dto.token });
  }

  @Public()
  @Get('line/link-page')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store, max-age=0')
  @Header('Referrer-Policy', 'no-referrer')
  @Header('Content-Security-Policy', LIFF_PAGE_CSP)
  @ApiOperation({ summary: 'Local LIFF account-link page' })
  async lineLinkPage(@Req() req: Request): Promise<string> {
    const liffId = this.config.lineLiffId ?? '';
    const devMode = this.config.isLocal;
    const apiBase = publicApiBase(req);
    const oaAddUrl = await this.getOaAddFriendUrl();
    return `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>มั่งมี Plus LINE Link</title>
  <style>
    body{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:0;padding:24px;line-height:1.5;color:#111827;background:#f9fafb}
    main{max-width:520px;margin:auto;background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:20px}
    button,a.btn{border:0;border-radius:6px;background:#16a34a;color:white;padding:10px 14px;font-weight:600;display:inline-block;text-decoration:none}
    [hidden]{display:none!important}
    button:disabled{opacity:.5}
    pre{white-space:pre-wrap;background:#f3f4f6;border-radius:6px;padding:12px}
  </style>
</head>
<body data-liff-mode="account" data-liff-id="${escapeHtml(liffId)}" data-api-base="${escapeHtml(apiBase)}" data-dev-mode="${String(devMode)}" data-oa-add-url="${escapeHtml(oaAddUrl)}">
  <main>
    ${LIFF_CLIENT_NOTICE_HTML}
    <div id="liff-content">
      <h1>มั่งมี Plus LINE Link</h1>
      <p id="status">Ready</p>
      <button id="link">Link LINE account</button>
      <pre id="detail"></pre>
    </div>
  </main>
  <script src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script>
  <script src="/v1/auth/line/link-page.js"></script>
</body>
</html>`;
  }

  @Public()
  @Get('line/link-page.js')
  @Header('Content-Type', 'application/javascript; charset=utf-8')
  @Header('Cache-Control', 'no-cache')
  @Header('X-Content-Type-Options', 'nosniff')
  @ApiOperation({ summary: 'Static same-origin LIFF account-link client' })
  lineLinkPageScript(): string {
    return LIFF_PAGE_SCRIPT;
  }

  // Deep link into the system LINE OA chat (LINE shows the add-friend prompt when
  // the user is not a friend yet). Resolved from bot info once per boot; empty
  // string when token/API is unavailable so the link pages fail open (no redirect).
  private oaAddFriendUrl?: string;

  private async getOaAddFriendUrl(): Promise<string> {
    if (this.oaAddFriendUrl !== undefined) return this.oaAddFriendUrl;
    const token = this.config.lineMessagingChannelAccessToken;
    if (!token) return '';
    try {
      const res = await fetch('https://api.line.me/v2/bot/info', {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return '';
      const { basicId } = (await res.json()) as { basicId?: string };
      if (!basicId) return '';
      this.oaAddFriendUrl = `https://line.me/R/ti/p/${encodeURIComponent(basicId)}`;
    } catch {
      return '';
    }
    return this.oaAddFriendUrl;
  }

  @Post('line/link')
  @HttpCode(200)
  @RequirePermissions('account.identity.link')
  @ApiOperation({ summary: 'Link LINE identity to current user' })
  @ApiBody({ type: LineLinkDto })
  @ApiResponse({ status: 200, description: 'LINE identity linked' })
  @ApiResponse({ status: 409, description: 'Already linked' })
  async lineLink(@Body() dto: LineLinkDto, @Req() req: Request & { context: RequestContext }) {
    const headerCompanyIdRaw = req.headers['x-company-id'];
    const headerCompanyId = Array.isArray(headerCompanyIdRaw) ? headerCompanyIdRaw[0] : headerCompanyIdRaw;
    return this.linkLineIdentity.execute({
      userId: req.context.userId,
      idToken: dto.idToken,
      requestId: req.context.requestId,
      companyId: dto.companyId ?? headerCompanyId,
    });
  }

  @Post('line/link/oauth')
  @HttpCode(200)
  @RequirePermissions('account.identity.link')
  @ApiOperation({ summary: 'Link LINE identity to current user from a web OAuth code (P12-2)' })
  @ApiBody({ type: LineLoginCallbackDto })
  @ApiResponse({ status: 200, description: 'LINE identity linked' })
  @ApiResponse({ status: 409, description: 'Already linked to another user' })
  async lineLinkOauth(@Body() dto: LineLoginCallbackDto, @Req() req: Request & { context: RequestContext }) {
    await this.authRateLimit.assertLineLoginCallbackAllowed(trustedClientIp(req));
    const headerCompanyIdRaw = req.headers['x-company-id'];
    const headerCompanyId = Array.isArray(headerCompanyIdRaw) ? headerCompanyIdRaw[0] : headerCompanyIdRaw;
    return this.lineLinkOauthUseCase.execute({
      userId: req.context.userId,
      code: dto.code,
      codeVerifier: dto.codeVerifier,
      nonce: dto.nonce,
      requestId: req.context.requestId,
      ...(headerCompanyId ? { companyId: headerCompanyId } : {}),
    });
  }

  @Public()
  // Path lives under line/link-page so liff.login redirectUri stays inside the registered LIFF endpoint URL scope; old path kept for already-issued QRs.
  @Get(['line/link-page/employee', 'line/employee-link-page'])
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store, max-age=0')
  @Header('Referrer-Policy', 'no-referrer')
  @Header('Content-Security-Policy', LIFF_PAGE_CSP)
  @ApiOperation({ summary: 'Employee-specific LIFF account-link page (no prior WatchDog session required)' })
  async employeeLineLinkPage(@Req() req: Request): Promise<string> {
    const liffId = this.config.lineLiffId ?? '';
    const apiBase = publicApiBase(req);
    const oaAddUrl = await this.getOaAddFriendUrl();
    return `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>มั่งมี Plus LINE Link</title>
  <style>
    body{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:0;padding:24px;line-height:1.5;color:#111827;background:#f9fafb}
    main{max-width:520px;margin:auto;background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:20px}
    button,a.btn{border:0;border-radius:6px;background:#16a34a;color:white;padding:10px 14px;font-weight:600;display:inline-block;text-decoration:none}
    [hidden]{display:none!important}
    button:disabled{opacity:.5}
    pre{white-space:pre-wrap;background:#f3f4f6;border-radius:6px;padding:12px}
  </style>
</head>
<body data-liff-mode="employee" data-liff-id="${escapeHtml(liffId)}" data-api-base="${escapeHtml(apiBase)}" data-oa-add-url="${escapeHtml(oaAddUrl)}">
  <main>
    ${LIFF_CLIENT_NOTICE_HTML}
    <div id="liff-content">
      <h1>Link your LINE account</h1>
      <p id="status">Ready</p>
      <button id="link">Link LINE account</button>
      <a id="open-line" class="btn" hidden>Open LINE</a>
      <pre id="detail"></pre>
    </div>
  </main>
  <script src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script>
  <script src="/v1/auth/line/link-page.js"></script>
</body>
</html>`;
  }

  @Public()
  @Post('line/employee-link')
  @HttpCode(200)
  @ApiOperation({ summary: 'Complete employee LINE account link using a short-lived link token' })
  @ApiBody({ type: EmployeeLineLinkDto })
  @ApiResponse({ status: 200, description: 'LINE identity linked (idempotent when the already-linked LINE account re-scans a used token)' })
  @ApiResponse({ status: 403, description: 'Token invalid, expired, revoked, used by another LINE account, or membership inactive' })
  async employeeLineLink(@Body() dto: EmployeeLineLinkDto, @Req() req: Request) {
    return this.completeEmployeeLineLink.execute({
      linkToken: dto.token,
      idToken: dto.idToken,
      requestId: (req.headers['x-request-id'] as string | undefined) ?? randomUUID(),
    });
  }

  @Post('line/unlink')
  @HttpCode(200)
  @RequirePermissions('account.identity.unlink')
  @ApiOperation({ summary: 'Unlink LINE identity from current user' })
  @ApiResponse({ status: 200, description: 'LINE identity unlinked' })
  @ApiResponse({ status: 404, description: 'No linked identity' })
  async lineUnlink(@Req() req: Request & { context: RequestContext }) {
    return this.unlinkLineIdentity.execute({ userId: req.context.userId, requestId: req.context.requestId });
  }

  @Post('password/change')
  @HttpCode(204)
  @RequirePermissions('account.password.change')
  @ApiOperation({ summary: 'Change current user password' })
  @ApiBody({ type: ChangePasswordDto })
  @ApiResponse({ status: 204, description: 'Password changed' })
  async changeCurrentPassword(
    @Body() dto: ChangePasswordDto,
    @Req() req: Request & { context: RequestContext },
  ): Promise<void> {
    const tokenId = extractSid(req);
    if (!tokenId) throw new UnauthorizedException('Cannot identify session.');
    await this.changePassword.execute(req.context.userId, dto.currentPassword, dto.newPassword, tokenId);
  }

  @Get('account/security')
  @RequirePermissions('account.session.read')
  @ApiOperation({ summary: 'Return email verification state for the current user' })
  @ApiResponse({ status: 200, description: 'Account security state returned' })
  async accountSecurityState(@Req() req: Request & { context: RequestContext }) {
    return this.getAccountSecurityState.execute(req.context.userId);
  }

  // PDPA objection route (M-05 register §3.1). Self-service write on the caller's own
  // account, gated by the same key as POST account/email — the established precedent.
  @Post('account/ai-assistant')
  @HttpCode(204)
  @RequirePermissions('account.password.change')
  @ApiOperation({ summary: 'Enable or disable the LINE AI assistant for the current user' })
  @ApiBody({ type: SetAiAssistantPreferenceDto })
  @ApiResponse({ status: 204, description: 'Preference updated' })
  async setAiAssistantPreference(
    @Body() dto: SetAiAssistantPreferenceDto,
    @Req() req: Request & { context: RequestContext },
  ): Promise<void> {
    await this.setAiAssistantPreferenceUseCase.execute(req.context.userId, dto.enabled, req.context.requestId);
  }

  @Post('account/email')
  @HttpCode(202)
  @RequirePermissions('account.password.change')
  @ApiOperation({ summary: 'Request an email change and send a verification link' })
  @ApiBody({ type: RequestEmailChangeDto })
  @ApiResponse({ status: 202, description: 'Verification request accepted' })
  async requestAccountEmailChange(
    @Body() dto: RequestEmailChangeDto,
    @Req() req: Request & { context: RequestContext },
  ) {
    await this.authRateLimit.assertEmailVerificationRequestAllowed(req.context.userId);
    return this.requestEmailChange.execute({
      userId: req.context.userId,
      currentPassword: dto.currentPassword,
      newEmail: dto.newEmail,
      requestId: req.context.requestId,
    });
  }

  @Post('account/email/resend')
  @HttpCode(202)
  @RequirePermissions('account.session.read')
  @ApiOperation({ summary: 'Resend the latest pending email verification link' })
  @ApiResponse({ status: 202, description: 'Verification email resent' })
  async resendAccountEmailVerification(@Req() req: Request & { context: RequestContext }) {
    await this.authRateLimit.assertEmailVerificationRequestAllowed(req.context.userId);
    return this.resendEmailVerification.execute({
      userId: req.context.userId,
      requestId: req.context.requestId,
    });
  }

  @Public()
  @Post('account/email/verify')
  @HttpCode(200)
  @ApiOperation({ summary: 'Confirm a pending email verification token' })
  @ApiBody({ type: VerifyEmailDto })
  @ApiResponse({ status: 200, description: 'Email verified' })
  async verifyAccountEmail(@Body() dto: VerifyEmailDto, @Req() req: Request) {
    await this.authRateLimit.assertEmailVerificationConfirmAllowed(trustedClientIp(req));
    return this.confirmEmailVerification.execute({
      token: dto.token,
      requestId: (req.headers['x-request-id'] as string | undefined) ?? randomUUID(),
    });
  }

  @Public()
  @Post('session/refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Refresh access token using refresh token' })
  @ApiBody({ type: RefreshDto })
  @ApiResponse({ status: 200, description: 'New tokens issued' })
  @ApiResponse({ status: 401, description: 'Invalid or expired refresh token' })
  async refresh(@Body() dto: RefreshDto) {
    return this.refreshSession.execute(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(204)
  @RequirePermissions('account.session.read')
  @ApiOperation({ summary: 'Revoke current session' })
  @ApiResponse({ status: 204, description: 'Session revoked' })
  async logoutSession(@Req() req: Request & { context: RequestContext }): Promise<void> {
    const tokenId = extractSid(req);
    if (!tokenId) throw new UnauthorizedException('Cannot identify session.');
    await this.logout.execute(tokenId, req.context.userId, req.context.requestId);
  }

  @Post('sessions/revoke-others')
  @HttpCode(200)
  @RequirePermissions('account.session.read')
  @ApiOperation({ summary: 'Revoke all active sessions except the current session' })
  @ApiResponse({ status: 200, description: 'Other sessions revoked' })
  async revokeOtherActiveSessions(@Req() req: Request & { context: RequestContext }) {
    const tokenId = extractSid(req);
    if (!tokenId) throw new UnauthorizedException('Cannot identify session.');
    return this.revokeOtherSessions.execute({
      userId: req.context.userId,
      currentTokenId: tokenId,
      requestId: req.context.requestId,
    });
  }

  @Get('legal-acceptance')
  @RequirePermissions('account.session.read')
  @ApiOperation({ summary: 'Return the current Terms acceptance and Privacy Notice acknowledgment status' })
  @ApiResponse({ status: 200, description: 'Current legal document status and server-authored statements returned' })
  async legalAcceptanceStatus(@Req() req: Request & { context: RequestContext }) {
    return this.legalAcceptance.getStatus(req.context);
  }

  @Post('legal-acceptance')
  @HttpCode(200)
  @RequirePermissions('account.session.read')
  @ApiOperation({ summary: 'Accept the current Terms and acknowledge the current Privacy Notice' })
  @ApiBody({ type: AcceptLegalDocumentsDto })
  @ApiResponse({ status: 200, description: 'Versioned acceptance evidence recorded or returned idempotently' })
  @ApiResponse({ status: 403, description: 'Temporary password must be changed first' })
  @ApiResponse({ status: 409, description: 'Submitted legal document version is stale' })
  async acceptLegalDocuments(
    @Body() dto: AcceptLegalDocumentsDto,
    @Req() req: Request & { context: RequestContext },
  ) {
    const tokenId = extractSid(req);
    if (!tokenId) throw new UnauthorizedException('Cannot identify session.');
    const userAgentHeader = req.headers['user-agent'];
    const userAgent = Array.isArray(userAgentHeader) ? userAgentHeader[0] : userAgentHeader;
    return this.legalAcceptance.accept({
      ...req.context,
      sessionTokenId: tokenId,
      ...(userAgent ? { userAgent } : {}),
    }, dto);
  }

  @Get('me')
  @RequirePermissions('account.session.read')
  @ApiOperation({ summary: 'Return current authenticated context' })
  @ApiResponse({ status: 200, description: 'Current user context' })
  async me(@Req() req: Request & { context: RequestContext }) {
    const { userId, companyId, membershipId, roles, permissions, scopes, authProvider } = req.context;
    const [user, credential, legalAcceptance, membership] = await Promise.all([
      this.prisma.client.user.findUnique({ where: { id: userId }, select: { displayName: true } }),
      this.prisma.client.userCredential.findUnique({ where: { userId }, select: { mustChangePassword: true } }),
      this.legalAcceptance.getStatus(req.context),
      this.prisma.client.companyMembership.findFirst({
        where: { id: membershipId, companyId, userId, status: 'ACTIVE' },
        select: { roles: { where: { role: { key: { in: roles } } }, select: { role: { select: { key: true, name: true } } } } },
      }),
    ]);
    // AuthGuard exempts /v1/auth/* from the temporary-password block, so this route answers for a
    // blocked session too — and it is the only way such a session can learn that it is blocked.
    // Reported straight from the credential: a LINE session the guard would let through still reads
    // true here, which only ever makes a caller more cautious, never less.
    return {
      userId,
      displayName: user?.displayName ?? null,
      companyId,
      membershipId,
      roles,
      // Display-only metadata for the caller's held roles; role keys still decide authorization.
      roleNames: Object.fromEntries((membership?.roles ?? []).map(({ role }) => [role.key, role.name])),
      permissions,
      scopes,
      authProvider,
      mustChangePassword: credential?.mustChangePassword ?? false,
      legalAcceptanceRequired: legalAcceptance.required,
    };
  }

  @Get('me/companies')
  @RequirePermissions('account.session.read')
  @ApiOperation({ summary: 'List active company memberships of the current user' })
  @ApiResponse({ status: 200, description: 'Active memberships in active companies' })
  async myCompanies(@Req() req: Request & { context: RequestContext }) {
    // Term-expired companies stay listed (P29 §4B): the owner must still find the shop to renew
    // it. Only term-driven disables qualify — an admin-disabled company stays hidden as before.
    const memberships = await this.prisma.client.companyMembership.findMany({
      where: {
        userId: req.context.userId,
        status: 'ACTIVE',
        OR: [
          { company: { status: 'ACTIVE' } },
          { company: { status: 'DISABLED', planTerm: { termDisabledAt: { not: null } } } },
        ],
      },
      select: {
        companyId: true,
        company: { select: { name: true, status: true, planTerm: { select: { termEndsAt: true } } } },
        roles: { select: { role: { select: { key: true } } } },
      },
      orderBy: { createdAt: 'asc' },
    });
    const now = Date.now();
    return {
      data: memberships.map((m) => ({
        companyId: m.companyId,
        companyName: m.company.name,
        roles: m.roles.map((r) => r.role.key),
        // Exact-hour truth, not sweep truth: an ACTIVE company past its term is already expired.
        expired:
          m.company.status === 'DISABLED' ||
          (m.company.planTerm ? m.company.planTerm.termEndsAt.getTime() <= now : false),
      })),
    };
  }
}
