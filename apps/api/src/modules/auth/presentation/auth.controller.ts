import { SetMyDisplayNameDto } from './auth.dtos';
import { isFreeExpenseDraftCompany } from '../../system-partner-management/application/free-expense-access';
import { ConflictException } from '@nestjs/common';
import { LineMessagingCredentialsService } from '../../../common/config/line-messaging-credentials.service';
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
  Patch,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Equals, IsBoolean, IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, Length, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { Transform } from 'class-transformer';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { Public } from '../../../common/security/public.decorator';
import { trustedClientIp } from '../../../common/security/trusted-client-ip';
import {
  COMPANY_ID_PATTERN,
  EMPLOYEE_LINE_LINK_TOKEN_PATTERN,
  escapeHtml,
  LIFF_PAGE_CSP,
  LIFF_PAGE_SCRIPT,
  liffPageHtml,
  liffPageScriptCacheControl,
  LIFF_EVENT_DISCOUNT_PAGE,
  LINE_CHANNEL_ID_PATTERN,
  LINE_ID_TOKEN_MAX_LENGTH,
  LINE_ID_TOKEN_PATTERN,
} from '../../../common/security/liff-page.security';
import { BILLING_PAID_TIERS, type BillingInterval, type PaidTier, CURRENT_LEGAL_DOCUMENTS, legalAcceptanceStatements, planTermLockReason, planTermState, SIGNUP_DISCOVERY_SOURCE_OPTIONS, SIGNUP_DISCOVERY_OTHER_MAX } from '@watchdog-bms/contracts';
import { PACKAGE_ADVISOR_CONTENT, PACKAGE_ADVISOR_SCRIPT, PACKAGE_ADVISOR_STYLE } from '../../../common/security/line-package-advisor.page';
import { STAFF_OA_URL } from '../../line-ai/domain/logic/line-staff-menu.logic';
import { currentLegalRelease } from '../application/legal-acceptance.service';
// The one place the signup form's length limit is decided; the input must not drift from it.
import { LINE_SIGNUP_COMPANY_NAME_MAX } from '../../external-signup/domain/line-signup.logic';
import { manualExpenseWebEntryState } from '../../system-partner-management/domain/logic/manual-expense-web-entry.logic';
import { disbursementVoucherWebEntryState } from '../../system-partner-management/domain/logic/disbursement-voucher-web-entry.logic';
import {
  ExchangeLiffSessionUseCase,
  type ExchangeLiffSessionResult,
} from '../application/use-cases/exchange-liff-session.use-case';
import { accessTokenFromCookies } from './auth-cookie.constants';
import { publicApiBase, requiredWebAppBase } from '../../../common/http/public-api-base';
import { RequirePermissions } from '../../../common/security/permissions.decorator';
import { AppConfigService } from '../../../common/config/app-config.service';
import { emitSecurityEvent, SECURITY_EVENT } from '../../../common/logger/security-event';
import { PrismaService } from '../../../common/database/prisma.service';
import { IssueTokenUseCase } from '../application/use-cases/issue-token.use-case';
import { ExchangeLineTokenUseCase } from '../application/use-cases/exchange-line-token.use-case';
import { LineLoginCallbackUseCase } from '../application/use-cases/line-login-callback.use-case';
import { LineLinkOauthUseCase } from '../application/use-cases/line-link-oauth.use-case';
import { AccountMergeUseCase } from '../application/use-cases/account-merge.use-case';
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
import { canSkipCurrentPassword, ChangePasswordUseCase } from '../application/use-cases/change-password.use-case';
import { CompleteEmployeeLineLinkUseCase } from '../application/use-cases/complete-employee-line-link.use-case';
import { NotifyPasswordResetRequestUseCase } from '../application/use-cases/notify-password-reset-request.use-case';
import { GetAccountSecurityStateUseCase } from '../application/use-cases/get-account-security-state.use-case';
import { SetAiAssistantPreferenceUseCase } from '../application/use-cases/set-ai-assistant-preference.use-case';
import { RequestEmailChangeUseCase } from '../application/use-cases/request-email-change.use-case';
import { AccountProfileUseCase } from '../application/use-cases/account-profile.use-case';
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

// Spec §4F: 32 random bytes rendered base64url (secure-token.logic.ts). Bounded so a hostile body
// cannot reach the hash function with something the size of a payload.
class AccountMergeDto {
  @IsString() @Matches(/^[A-Za-z0-9_-]{40,128}$/) ticket!: string;
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

/** P10-L §4: the token is the credential; `companyId` is only ever an echo of a picker choice. */
class LiffSessionDto {
  @IsOptional() @IsIn(BILLING_PAID_TIERS) billingOffer?: PaidTier;
  @IsOptional() @IsIn(['month', 'year']) billingInterval?: BillingInterval;
  @IsString() @IsNotEmpty() @MaxLength(LINE_ID_TOKEN_MAX_LENGTH) @Matches(LINE_ID_TOKEN_PATTERN) idToken!: string;
  @IsString() @IsOptional() @MaxLength(128) @Matches(COMPANY_ID_PATTERN) companyId?: string;
  /** Sales-event page (spec §3.3): a name from this list, never a path — the server builds the path. */
  @IsOptional() @IsIn(['package']) landing?: 'package';
  /** The page a LINE message's link pointed at. Checked against the token's own memberships. */
  @IsString() @IsOptional() @MaxLength(512) to?: string;
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
  @IsString() @IsNotEmpty() @IsOptional() currentPassword?: string;
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
  @IsString() @IsNotEmpty() @MaxLength(254) username!: string;
}

export class SetUnverifiedEmailDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  @IsEmail() @MaxLength(254) newEmail!: string;
  @ValidateIf((dto) => dto.expectedEmail !== null) @IsString() @MaxLength(320) expectedEmail!: string | null;
  @IsString() @IsNotEmpty() @IsOptional() currentPassword?: string;
}

class RequestEmailChangeDto {
  // Optional only for an account that has no credential at all (P10-L §15.4). The use case, not
  // the pipe, decides that: it demands the password whenever one exists.
  @IsString() @IsNotEmpty() @IsOptional() currentPassword?: string;
  @IsEmail() @MaxLength(320) newEmail!: string;
}

class SetMyContactDto {
  /** Blank clears the stored number. Shape is enforced by `normalizeThaiMobile` in the use case. */
  @IsString() @IsOptional() @MaxLength(20) phoneNumber?: string;
}

class SetFirstPasswordDto {
  @IsString() @MinLength(8) password!: string;
  @IsString() @IsOptional() @MaxLength(64) username?: string;
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
export function extractSid(req: Request): string | undefined {
  const bearerHeader = req.headers['authorization'] as string | undefined;
  const headerToken = bearerHeader?.startsWith('Bearer ') ? bearerHeader.slice(7) : undefined;
  const cookieToken = accessTokenFromCookies((req as Record<string, any>)['cookies']);
  return extractSidFromToken(headerToken ?? cookieToken);
}

/** Owner 2026-10-20: "ติดต่อเจ้าหน้าที่" on the open-shop page opens the Official OA chat (@695ultfm, premium id @mangmeeplus). */
const OFFICIAL_OA_CHAT_URL = 'https://line.me/R/ti/p/@695ultfm';

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(private readonly lineCredentials: LineMessagingCredentialsService,
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
    private readonly accountMergeUseCase: AccountMergeUseCase,
    private readonly createLineWebLoginTransaction: CreateLineWebLoginTransactionUseCase,
    private readonly approveLineWebLoginTransaction: ApproveLineWebLoginTransactionUseCase,
    private readonly redeemLineWebLoginTransaction: RedeemLineWebLoginTransactionUseCase,
    private readonly exchangeLineHandoffToken: ExchangeLineHandoffTokenUseCase,
    private readonly exchangeLiffSession: ExchangeLiffSessionUseCase,
    private readonly accountProfile: AccountProfileUseCase,
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
  @RequirePermissions('account.session.read')
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
    return liffPageHtml({
      title: 'มั่งมี Plus LINE Link',
      data: {
        'liff-mode': 'account',
        'liff-id': liffId,
        'api-base': apiBase,
        'dev-mode': String(devMode),
        'oa-add-url': oaAddUrl,
      },
      content: `      <h1>มั่งมี Plus LINE Link</h1>
      <p id="status" class="notice notice-info">Ready</p>
      <button id="link">Link LINE account</button>
      <pre id="detail"></pre>`,
    });
  }

  @Public()
  @Get('line/link-page.js')
  @Header('Content-Type', 'application/javascript; charset=utf-8')
  @Header('X-Content-Type-Options', 'nosniff')
  @ApiOperation({ summary: 'Static same-origin LIFF account-link client' })
  lineLinkPageScript(@Query('v') version: unknown, @Res({ passthrough: true }) res: Response): string {
    res.setHeader('Cache-Control', liffPageScriptCacheControl(version));
    return LIFF_PAGE_SCRIPT;
  }

  @Public()
  @Get(['line/link-page/package-advisor', 'line/package-advisor-page'])
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store, max-age=0')
  @Header('Referrer-Policy', 'no-referrer')
  @Header('Content-Security-Policy', LIFF_PAGE_CSP)
  @ApiOperation({ summary: 'Read-only LIFF package advisor using the public catalog' })
  async linePackageAdvisorPage(@Req() req: Request): Promise<string> {
    return liffPageHtml({
      title: 'ให้มั่งมีช่วยเลือกแพ็กเกจ', client: 'package-advisor',
      data: {
        'liff-mode': 'package-advisor', 'liff-id': this.config.lineLiffId ?? '',
        'api-base': publicApiBase(req),
        'web-base': requiredWebAppBase(this.config.sesWebBaseUrl).replace(/\/+$/, ''),
        'oa-add-url': await this.getOaAddFriendUrl(),
        'support-url': STAFF_OA_URL,
      },
      content: PACKAGE_ADVISOR_CONTENT, style: PACKAGE_ADVISOR_STYLE,
    });
  }

  @Public()
  @Get('line/package-advisor.js')
  @Header('Content-Type', 'application/javascript; charset=utf-8')
  @Header('Cache-Control', 'no-cache')
  @Header('X-Content-Type-Options', 'nosniff')
  linePackageAdvisorScript(): string { return PACKAGE_ADVISOR_SCRIPT; }

  /**
   * P10-L §3.2. The signup form, rendered by the API so the binding acceptance block is the release
   * the SERVER is serving right now — statement text, version and challenge all come off
   * `currentLegalRelease()` at render time, and the submit is refused unless the page echoes them
   * back unchanged (LEGAL-LIFF-01).
   */
  @Public()
  // Both paths, for the same reason the employee page has two: `https://liff.line.me/<id>/signup`
  // resolves against the REGISTERED LIFF endpoint URL (`.../line/link-page`), so the sub-path is
  // what a real tap hits, while `line/signup-page` is the name spec §4 gives the contract.
  @Get(['line/link-page/signup', 'line/signup-page'])
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store, max-age=0')
  @Header('Referrer-Policy', 'no-referrer')
  @Header('Content-Security-Policy', LIFF_PAGE_CSP)
  @ApiOperation({ summary: 'LIFF signup page for a LINE-first company application (P10-L §3.2)' })
  lineSignupPage(@Req() req: Request): string {
    const release = currentLegalRelease('th');
    const statements = legalAcceptanceStatements('th');
    // Not the API origin, and not a silent empty string: these two links are what makes the
    // acceptance binding, so an environment that cannot serve them refuses the page (503) the same
    // way the session exchange refuses to build a handoff URL it cannot point anywhere.
    const webBase = requiredWebAppBase(this.config.sesWebBaseUrl).replace(/\/+$/, '');
    return liffPageHtml({
      title: 'เปิดร้านใหม่',
      data: {
        'liff-mode': 'signup',
        'liff-id': this.config.lineLiffId ?? '',
        'api-base': publicApiBase(req),
        'legal-version': release.documentVersion,
        'legal-statement': release.statementSha256,
        'legal-release': release.releaseFingerprintSha256,
        'legal-challenge': release.displayChallenge,
        'legal-locale': 'th',
      },
      style: 'label{display:block;margin-top:16px;margin-bottom:6px;font-weight:600}'
        + '\n    input{width:100%;min-height:48px;padding:12px;border:1px solid var(--line);border-radius:10px;font-size:16px;font-family:inherit;color:var(--ink)}'
        + '\n    .secondary{margin-top:10px;background:#fff;color:var(--brand-dark);border:1px solid var(--brand-dark)}'
        + '\n    .quiet,a.btn.quiet{margin-top:10px;background:#fff;color:var(--ink);border:1px solid var(--line)}'
        + '\n    .actions{margin-top:16px}'
        + '\n    .actions button+button{margin-top:10px}'
        + '\n    .legal{margin-top:20px;padding:12px;background:var(--ground);border:1px solid var(--line);border-radius:10px;font-size:14px}'
        + '\n    .legal li{margin-bottom:6px}'
        + '\n    .fine{color:var(--muted);font-size:14px}'
        + '\n    .discovery{border:0;padding:0;margin:24px 0 0;min-width:0}.discovery legend{font-weight:600;padding:0}.discovery .fine{margin:4px 0 12px}'
        + '\n    .discovery-options{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.discovery-option{display:flex;align-items:center;gap:9px;min-height:48px;margin:0;padding:12px;border:1px solid var(--line);border-radius:10px;font-weight:400;cursor:pointer}'
        + '\n    .discovery-option input{width:18px;min-height:18px;height:18px;margin:0;padding:0;flex-shrink:0;accent-color:var(--brand-dark)}.discovery-option:has(input:checked){border-color:var(--brand-dark);background:var(--ground)}.discovery-option:last-child{grid-column:1/-1}'
        // No <p> wrapper around the button: a hidden button inside a visible paragraph still left
        // that paragraph's margins on the page, as a 16px gap under the notice (review LOW-5).
        + '\n    #notice-action{margin-bottom:12px}',
      content: `      <p id="greeting"></p>
      <p id="status" class="notice notice-info">กำลังเตรียมหน้าให้ค่ะ</p>
      <button id="notice-action" hidden></button>
      <div id="companies" class="actions" hidden></div>
      <button id="open-web" type="button" hidden>เปิดหน้าเว็บ</button>
      <section id="retry-view" data-view hidden>
        <p>กรุณาเปิดลิงก์นี้จากแอป LINE นะคะ ถ้าเปิดจากเบราว์เซอร์ปกติจะยังสมัครไม่ได้ค่ะ</p>
        <p><button id="retry">ลองอีกครั้ง</button></p>
      </section>
      <section id="form-view" data-view hidden>
        <h1 id="form-title">เปิดร้านใหม่</h1>
        <label for="company-name">ชื่อร้าน</label>
        <input id="company-name" type="text" maxlength="${LINE_SIGNUP_COMPANY_NAME_MAX}" autocomplete="organization" />
        <p id="company-name-error" class="field-error" hidden></p>
        <label for="phone-number">เบอร์มือถือ</label>
        <input id="phone-number" type="tel" inputmode="tel" maxlength="10" autocomplete="tel-national" required />
        <p id="phone-number-error" class="field-error" hidden></p>
        <label for="contact-email">อีเมลติดต่อร้าน (ไม่บังคับ)</label>
        <input id="contact-email" type="email" inputmode="email" maxlength="254" autocomplete="email" autocapitalize="none" aria-describedby="contact-email-help" />
        <p id="contact-email-error" class="field-error" hidden></p>
        <p id="contact-email-help" class="fine">เพิ่มภายหลังได้ อีเมลรับเอกสารกรอกได้ที่หน้าชำระเงิน</p>
        <fieldset id="discovery-source" class="discovery" tabindex="-1" aria-describedby="discovery-source-help discovery-source-error">
          <legend>รู้จักเราทางไหน</legend>
          <p id="discovery-source-help" class="fine">เลือก 1 ช่องทาง (ไม่บังคับ)</p>
          <div class="discovery-options">
            ${SIGNUP_DISCOVERY_SOURCE_OPTIONS.map((option) => `<label class="discovery-option"><input type="radio" name="discovery-source" value="${option.value}" /><span>${option.label}</span></label>`).join('\n            ')}
          </div>
          <p id="discovery-source-error" class="field-error" hidden></p>
          <div id="discovery-other-fields" hidden>
            <label for="discovery-source-other">ระบุช่องทางอื่น ๆ</label>
            <input id="discovery-source-other" type="text" maxlength="${SIGNUP_DISCOVERY_OTHER_MAX}" placeholder="เช่น เพื่อนแนะนำ" aria-describedby="discovery-source-other-error" disabled />
            <p id="discovery-source-other-error" class="field-error" hidden></p>
          </div>
          <div id="discovery-sales-fields" hidden>
            <label for="referral-sales-code">รหัสเซลล์</label>
            <input id="referral-sales-code" type="text" maxlength="6" inputmode="latin" autocapitalize="characters" autocomplete="off" placeholder="เช่น TON" aria-describedby="referral-sales-code-help referral-sales-code-error" disabled />
            <p id="referral-sales-code-help" class="fine">รหัส 3–6 ตัว ตัวอักษรหรือตัวเลข สอบถามจากเซลล์ที่ดูแลคุณ</p>
            <p id="referral-sales-code-error" class="field-error" hidden></p>
          </div>
        </fieldset>
        <section class="legal">
          <p>${escapeHtml(CURRENT_LEGAL_DOCUMENTS.terms.titleTh)} และ${escapeHtml(CURRENT_LEGAL_DOCUMENTS.privacy.titleTh)} ${escapeHtml(CURRENT_LEGAL_DOCUMENTS.terms.displayVersionTh)}</p>
          <ul>
            <li>${escapeHtml(statements.terms)}</li>
            <li>${escapeHtml(statements.privacy)}</li>
            <li>${escapeHtml(statements.deletion)}</li>
          </ul>
          <p><a href="${escapeHtml(`${webBase}${CURRENT_LEGAL_DOCUMENTS.terms.latestHref}`)}" target="_blank" rel="noopener">อ่านข้อกำหนดการใช้งาน</a></p>
          <p><a href="${escapeHtml(`${webBase}${CURRENT_LEGAL_DOCUMENTS.privacy.latestHref}`)}" target="_blank" rel="noopener">อ่านประกาศความเป็นส่วนตัว</a></p>
        </section>
        <p><button id="link" disabled>ยอมรับและเปิดร้าน</button></p>
        <p class="fine">เลือกแพ็กเกจเพื่อเริ่มใช้งานหลังเปิดร้าน (เริ่มต้น 249 บาทต่อเดือน)</p>
        <button id="start-existing" type="button" class="secondary">เคยใช้แล้ว เข้าร้านเดิม</button>
        <a id="form-support" class="btn quiet" href="${OFFICIAL_OA_CHAT_URL}">ติดต่อเจ้าหน้าที่ · LINE @mangmeeplus</a>
      </section>
      <section id="progress-view" data-view hidden>
        <h2 id="progress-title"></h2>
        <p id="progress-text"></p>
        <div id="existing-companies" class="actions"></div>
        <section id="email-update" hidden>
          <label for="updated-contact-email">อีเมลติดต่อร้าน (เว้นว่างได้)</label>
          <input id="updated-contact-email" type="email" inputmode="email" maxlength="254" autocomplete="email" autocapitalize="none" />
          <p id="updated-contact-email-error" class="field-error" hidden></p>
          <button id="save-email" type="button">บันทึกอีเมลและทำคำขอเดิมต่อ</button>
        </section>
        <div class="actions">
          <button id="retry-intake" type="button" hidden>ทำคำขอเดิมต่อ</button>
          <button id="retry-status" type="button" hidden>ตรวจสอบสถานะอีกครั้ง</button>
          <button id="edit-email" type="button" class="secondary" hidden>แก้อีเมล</button>
          <button id="add-shop" type="button" class="secondary" hidden>เปิดร้านเพิ่ม</button>
          <a id="support" class="btn quiet" href="${OFFICIAL_OA_CHAT_URL}" hidden>ติดต่อเจ้าหน้าที่ · LINE @mangmeeplus</a>
          <button data-close type="button" class="quiet">ปิด</button>
        </div>
      </section>
      <pre id="detail"></pre>`,
    });
  }

  /**
   * P10-L §3.5. "เริ่มใช้งาน": no form, no login screen — the page proves who tapped and opens the
   * minted destination in the EXTERNAL browser, because the cookie must land in Safari/Chrome and
   * not in the LINE in-app browser (QR fix 2026-09-01).
   */
  @Public()
  /** Sub-path first, for `https://liff.line.me/<id>/start`; the spec §4 name is the alias. */
  @Get(['line/link-page/start', 'line/start-page'])
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store, max-age=0')
  @Header('Referrer-Policy', 'no-referrer')
  @Header('Content-Security-Policy', LIFF_PAGE_CSP)
  @ApiOperation({ summary: 'LIFF start page: exchange a LINE identity for a web session (P10-L §3.5)' })
  lineStartPage(@Req() req: Request): string {
    return liffPageHtml({
      title: 'เริ่มใช้งานมั่งมีพลัส',
      data: {
        'liff-mode': 'start',
        'liff-id': this.config.lineLiffId ?? '',
        'api-base': publicApiBase(req),
      },
      style: '#companies button{display:block;width:100%;margin-top:8px}',
      content: `      <h1>เริ่มใช้งาน</h1>
      <p id="status" class="notice notice-info">กำลังเปิดหน้าเว็บให้ค่ะ</p>
      <div id="companies" hidden></div>
      <p><button id="open-web" type="button" hidden>เปิดหน้าเว็บ</button></p>
      <p><a id="go-signup" class="btn" href="/v1/auth/line/link-page/signup" hidden>เปิดร้านใหม่</a></p>
      <p><button id="link">ลองอีกครั้ง</button></p>
      <pre id="detail"></pre>`,
    });
  }

  /**
   * Sales-event discounts (spec §3.3). A เซลล์'s booth QR opens `https://liff.line.me/<id>/event-discount?t=…`,
   * which resolves to this sub-path of the registered LIFF endpoint. The page claims with the LIFF ID
   * token (`POST /v1/public/event-discounts/claim`) and shows only what the batch gives; the QR token
   * stays in the page's own query string, which the request log never records.
   */
  @Public()
  @Get('line/link-page/event-discount')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store, max-age=0')
  @Header('Referrer-Policy', 'no-referrer')
  @Header('Content-Security-Policy', LIFF_PAGE_CSP)
  @ApiOperation({ summary: 'LIFF page: claim a sales-event discount after scanning a booth QR (sales-event spec §3.3)' })
  lineEventDiscountPage(@Req() req: Request): string {
    return liffPageHtml({
      ...LIFF_EVENT_DISCOUNT_PAGE,
      data: {
        'liff-mode': 'event-discount',
        'liff-id': this.config.lineLiffId ?? '',
        'api-base': publicApiBase(req),
      },
    });
  }

  /**
   * P10-L §4. The exchange behind the start page. `@Public()` because the ID token IS the
   * credential; the per-account bucket is spent inside, after the token proves whose it is.
   */
  @Public()
  @Post('line/liff/session')
  @HttpCode(200)
  @ApiOperation({ summary: 'Exchange a LIFF ID token for a one-time web handoff URL (P10-L §3.5)' })
  @ApiResponse({ status: 200, description: 'A handoff URL, or why one could not be minted' })
  @ApiResponse({ status: 401, description: 'LINE ID token invalid, expired or for another channel' })
  @ApiResponse({ status: 403, description: 'LINE web handoff is disabled' })
  async lineLiffSession(@Body() dto: LiffSessionDto): Promise<ExchangeLiffSessionResult> {
    return this.exchangeLiffSession.execute({
      idToken: dto.idToken,
      ...(dto.companyId ? { companyId: dto.companyId } : {}),
      ...(dto.billingOffer !== undefined ? { billingOffer: dto.billingOffer } : {}),
      ...(dto.billingInterval !== undefined ? { billingInterval: dto.billingInterval } : {}),
      ...(dto.landing ? { landing: dto.landing } : {}),
      ...(dto.to ? { to: dto.to } : {}),
    });
  }

  // Deep link into the system LINE OA chat (LINE shows the add-friend prompt when
  // the user is not a friend yet). Resolved from bot info once per boot; empty
  // string when token/API is unavailable so the link pages fail open (no redirect).
  private oaAddFriendUrl?: string;

  private async getOaAddFriendUrl(): Promise<string> {
    if (this.oaAddFriendUrl !== undefined) return this.oaAddFriendUrl;
    try {
      const token = (await this.lineCredentials.get()).accessToken;
      if (!token) return '';
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

  // Spec §4F "รวมเข้าบัญชีเดิม". The ticket only exists because this same session already proved
  // control of the other account's LINE identity, so no extra permission gates it — every account
  // may merge itself away. The response is a session for the *existing* account.
  @Post('account-merge')
  @HttpCode(200)
  @RequirePermissions('account.identity.link')
  @ApiOperation({ summary: 'Merge this account into the one that owns the conflicting LINE identity (spec §4F)' })
  @ApiBody({ type: AccountMergeDto })
  @ApiResponse({ status: 200, description: 'Accounts merged; tokens are for the existing account' })
  @ApiResponse({ status: 403, description: 'Ticket belongs to another session' })
  @ApiResponse({ status: 409, description: 'Ticket expired, already running, or target unavailable' })
  async accountMerge(@Body() dto: AccountMergeDto, @Req() req: Request & { context: RequestContext }) {
    await this.authRateLimit.assertLineLoginCallbackAllowed(trustedClientIp(req));
    return this.accountMergeUseCase.execute({
      userId: req.context.userId,
      ticket: dto.ticket,
      requestId: req.context.requestId,
    });
  }

  /**
   * Review R05: what the merge would do, before it is confirmed — which shops move, which block,
   * and which way of signing in survives. POST rather than GET because the ticket is a bearer
   * credential and a URL segment is recorded by every access log on the way in (review R01).
   */
  @Post('account-merge/preview')
  @HttpCode(200)
  @RequirePermissions('account.identity.link')
  @ApiOperation({ summary: 'What merging into the LINE-owning account would do (spec §4F)' })
  @ApiBody({ type: AccountMergeDto })
  @ApiResponse({ status: 200, description: 'Per-shop plan and the credentials that survive' })
  @ApiResponse({ status: 403, description: 'Ticket belongs to another session' })
  async accountMergePreview(@Body() dto: AccountMergeDto, @Req() req: Request & { context: RequestContext }) {
    // Review F6: its own bucket. Sharing the callback's 10-per-window meant opening this dialog a
    // few times could 429 the visitor's own LINE login — the thing the dialog exists to recover.
    await this.authRateLimit.assertAccountMergePreviewAllowed(trustedClientIp(req));
    return this.accountMergeUseCase.preview({ userId: req.context.userId, ticket: dto.ticket });
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
    return liffPageHtml({
      title: 'มั่งมี Plus LINE Link',
      data: {
        'liff-mode': 'employee',
        'liff-id': liffId,
        'api-base': apiBase,
        'oa-add-url': oaAddUrl,
      },
      content: `      <h1>เชื่อมบัญชี LINE</h1>
      <p id="status" class="notice notice-info">กำลังเตรียมการเชื่อมต่อ</p>
      <button id="link">เชื่อม LINE</button>
      <a id="open-line" class="btn" hidden>เปิด LINE</a>
      <pre id="detail"></pre>`,
    });
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
    await this.changePassword.execute(req.context.userId, dto.currentPassword, dto.newPassword, tokenId, req.context.sessionId);
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
    throw new ConflictException({ code: 'EMAIL_OTP_REQUIRED', message: 'กรุณาโหลดหน้านี้ใหม่เพื่อยืนยันอีเมลด้วยรหัส OTP' });
  }

  @Post('account/email/resend')
  @HttpCode(202)
  @RequirePermissions('account.session.read')
  @ApiOperation({ summary: 'Resend the latest pending email verification link' })
  @ApiResponse({ status: 202, description: 'Verification email resent' })
  async resendAccountEmailVerification(@Req() req: Request & { context: RequestContext }) {
    throw new ConflictException({ code: 'EMAIL_OTP_REQUIRED', message: 'กรุณาโหลดหน้านี้ใหม่เพื่อยืนยันอีเมลด้วยรหัส OTP' });
  }

  @Public()
  @Post('account/email/verify')
  @HttpCode(200)
  @ApiOperation({ summary: 'Confirm a pending email verification token' })
  @ApiBody({ type: VerifyEmailDto })
  @ApiResponse({ status: 200, description: 'Email verified' })
  async verifyAccountEmail(@Body() dto: VerifyEmailDto, @Req() req: Request) {
    throw new ConflictException({ code: 'EMAIL_OTP_REQUIRED', message: 'ลิงก์เดิมใช้ไม่ได้แล้ว กรุณาเข้าสู่ระบบและขอรหัส OTP ใหม่' });
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
    const [user, credential, legalAcceptance, membership, session, webEntrySetting] = await Promise.all([
      this.prisma.client.user.findUnique({ where: { id: userId }, select: { displayName: true } }),
      this.prisma.client.userCredential.findUnique({ where: { userId }, select: { mustChangePassword: true, updatedAt: true } }),
      this.legalAcceptance.getStatus(req.context),
      this.prisma.client.companyMembership.findFirst({
        where: { id: membershipId, companyId, userId, status: 'ACTIVE' },
        select: { roles: { where: { role: { key: { in: roles } } }, select: { role: { select: { key: true, name: true } } } } },
      }),
      req.context.sessionId
        ? this.prisma.client.authSession.findUnique({
          where: { id: req.context.sessionId },
          select: { passwordCredentialVersion: true },
        })
        : Promise.resolve(null),
      this.prisma.client.companyWebEntrySetting.findUnique({
        where: { companyId },
        select: { manualExpenseEntryEnabled: true, disbursementVoucherEntryEnabled: true, version: true },
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
      availablePermissions: req.context.availablePermissions,
      entitledFeatureKeys: req.context.entitledFeatureKeys,
      roleNames: Object.fromEntries((membership?.roles ?? []).map(({ role }) => [role.key, role.name])),
      permissions,
      ...(req.context.freeExpenseDrafts ? { freeExpenseDrafts: true } : {}),
      scopes,
      authProvider,
      mustChangePassword: credential?.mustChangePassword ?? false,
      canSkipCurrentPassword: canSkipCurrentPassword({
        credential,
        passwordCredentialVersion: session?.passwordCredentialVersion,
      }),
      legalAcceptanceRequired: legalAcceptance.required,
      // A screen setting of the company in this context, not an authority: the web uses it only to
      // show or hide the entrances to the manual expense page (spec §6.1). Read here, beside the
      // rest of this answer — never through ResolvedAccess or RequestContext, so it cannot reach a
      // guard, a use case or LINE.
      manualExpenseWebEntry: manualExpenseWebEntryState(webEntrySetting).enabled,
      // This is only a web entrance setting. It does not change the permissions in RequestContext.
      disbursementVoucherWebEntry: disbursementVoucherWebEntryState(webEntrySetting).enabled,
    };
  }

  // Every member can correct their own name; reading another person's history also checks the
  // employee-management grant and company membership inside the use case.
  @Get('account/display-name')
  @RequirePermissions('account.session.read')
  async displayNameHistory(@Query('companyId') companyId: string, @Query('userId') userId: string | undefined, @Req() req: Request & { context: RequestContext }) {
    return this.accountProfile.displayNameHistory(req.context, companyId, userId);
  }

  @Patch('account/display-name')
  @RequirePermissions('account.session.read')
  async setMyDisplayName(@Body() dto: SetMyDisplayNameDto, @Req() req: Request & { context: RequestContext }) {
    await this.authRateLimit.assertAccountProfileWriteAllowed(req.context.userId);
    return this.accountProfile.setDisplayName(req.context, dto.companyId, req.context.userId, dto.displayName);
  }

  @Patch('me/contact')
  @HttpCode(200)
  @RequirePermissions('account.password.change')
  @ApiOperation({ summary: 'Set or clear the current user recovery phone number' })
  @ApiBody({ type: SetMyContactDto })
  @ApiResponse({ status: 200, description: 'Contact number updated' })
  async setMyContact(@Body() dto: SetMyContactDto, @Req() req: Request & { context: RequestContext }) {
    await this.authRateLimit.assertAccountProfileWriteAllowed(req.context.userId);
    return this.accountProfile.setPhoneNumber(req.context.userId, dto.phoneNumber, req.context.requestId);
  }

  @Post('me/password/set')
  @HttpCode(200)
  @RequirePermissions('account.password.change')
  @ApiOperation({ summary: 'Set the first password for an account that has none' })
  @ApiBody({ type: SetFirstPasswordDto })
  @ApiResponse({ status: 200, description: 'Password set; answers the stored username' })
  @ApiResponse({ status: 400, description: 'This account has no email, so a username is required' })
  @ApiResponse({ status: 409, description: 'This account already has a password' })
  async setMyFirstPassword(@Body() dto: SetFirstPasswordDto, @Req() req: Request & { context: RequestContext }) {
    // `username_taken` makes this an enumeration oracle for anyone holding one valid session.
    await this.authRateLimit.assertAccountProfileWriteAllowed(req.context.userId);
    // Same session identity ChangePassword uses, so the caller's own tab survives the revocation.
    const tokenId = extractSid(req);
    if (!tokenId) throw new UnauthorizedException('Cannot identify session.');
    return this.accountProfile.setInitialPassword(
      req.context.userId, dto.password, dto.username, req.context.requestId, tokenId,
    );
  }

  @Post('me/email/unverified')
  @HttpCode(200)
  @RequirePermissions('account.password.change')
  @ApiOperation({ summary: 'Correct a LINE-linked account unverified email without email delivery' })
  @ApiBody({ type: SetUnverifiedEmailDto })
  async setMyUnverifiedEmail(@Body() dto: SetUnverifiedEmailDto, @Req() req: Request & { context: RequestContext }) {
    throw new ConflictException({ code: 'EMAIL_OTP_REQUIRED', message: 'กรุณาโหลดหน้านี้ใหม่เพื่อยืนยันอีเมลด้วยรหัส OTP' });
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
        company: { select: { name: true, status: true, planTerm: { select: { tierKey: true, termStartAt: true, termEndsAt: true, renewCount: true, termDisabledAt: true } } } },
        roles: {
          where: { role: { status: 'ACTIVE' } },
          select: { role: { select: { key: true, name: true, permissions: { select: { permission: { select: { key: true } } } } } } },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    const now = Date.now();
    return {
      data: await Promise.all(memberships.map(async (m) => ({
        companyId: m.companyId,
        companyName: m.company.name,
        roles: m.roles.map((r) => r.role.key),
        roleNames: Object.fromEntries(m.roles.map(({ role }) => [role.key, role.name])),
        ...(m.company.planTerm && m.company.planTerm.termEndsAt.getTime() <= now
          && await isFreeExpenseDraftCompany(this.prisma.client, m.companyId) ? { freeExpenseDrafts: true } : {}),
        canManagePlan: m.roles.some((r) => r.role.permissions.some((rp) => rp.permission.key === 'company.plan.manage')),
        // Exact-hour truth, not sweep truth: an ACTIVE company past its term is already expired.
        expired:
          m.company.status === 'DISABLED' ||
          (m.company.planTerm ? m.company.planTerm.termEndsAt.getTime() <= now : false),
        // R-C5/R-C7: the picker and the switcher say WHY the shop is locked, from the one helper.
        planState: planTermState(m.company.planTerm, new Date(now), m.company.status),
        ...(m.company.planTerm && m.company.planTerm.termEndsAt.getTime() <= now ? { lockReason: planTermLockReason(m.company.planTerm) } : {}),
      }))),
    };
  }
}
