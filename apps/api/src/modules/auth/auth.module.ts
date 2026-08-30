import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { SESClient } from '@aws-sdk/client-ses';
import { DevJwtVerifierAdapter } from './infrastructure/dev-jwt-verifier.adapter';
import { WatchdogJwtVerifierAdapter } from './infrastructure/watchdog-jwt-verifier.adapter';
import { LineLoginVerifierAdapter } from './infrastructure/line-login-verifier.adapter';
import { LineLoginTokenClient } from './infrastructure/line-login-token.client';
import { ResolveRequestContextUseCase } from './application/use-cases/resolve-request-context.use-case';
import { IssueTokenUseCase } from './application/use-cases/issue-token.use-case';
import { ExchangeLineTokenUseCase } from './application/use-cases/exchange-line-token.use-case';
import { LineLoginCallbackUseCase } from './application/use-cases/line-login-callback.use-case';
import { LineLinkOauthUseCase } from './application/use-cases/line-link-oauth.use-case';
import { CreateLineWebLoginTransactionUseCase } from './application/use-cases/create-line-web-login-transaction.use-case';
import { ApproveLineWebLoginTransactionUseCase } from './application/use-cases/approve-line-web-login-transaction.use-case';
import { RedeemLineWebLoginTransactionUseCase } from './application/use-cases/redeem-line-web-login-transaction.use-case';
import { MintLineHandoffTokenUseCase } from './application/use-cases/mint-line-handoff-token.use-case';
import { ExchangeLineHandoffTokenUseCase } from './application/use-cases/exchange-line-handoff-token.use-case';
import { RefreshSessionUseCase } from './application/use-cases/refresh-session.use-case';
import { LogoutUseCase } from './application/use-cases/logout.use-case';
import { RevokeOtherSessionsUseCase } from './application/use-cases/revoke-other-sessions.use-case';
import { LinkLineIdentityUseCase } from './application/use-cases/link-line-identity.use-case';
import { UnlinkLineIdentityUseCase } from './application/use-cases/unlink-line-identity.use-case';
import { CompleteEmployeeLineLinkUseCase } from './application/use-cases/complete-employee-line-link.use-case';
import { PasswordLoginUseCase } from './application/use-cases/password-login.use-case';
import { ChangePasswordUseCase } from './application/use-cases/change-password.use-case';
import { RequestPasswordResetUseCase } from './application/use-cases/request-password-reset.use-case';
import { ConfirmPasswordResetUseCase } from './application/use-cases/confirm-password-reset.use-case';
import { NotifyPasswordResetRequestUseCase } from './application/use-cases/notify-password-reset-request.use-case';
import { GetAccountSecurityStateUseCase } from './application/use-cases/get-account-security-state.use-case';
import { SetAiAssistantPreferenceUseCase } from './application/use-cases/set-ai-assistant-preference.use-case';
import { RequestEmailChangeUseCase } from './application/use-cases/request-email-change.use-case';
import { ResendEmailVerificationUseCase } from './application/use-cases/resend-email-verification.use-case';
import { ConfirmEmailVerificationUseCase } from './application/use-cases/confirm-email-verification.use-case';
import { AuthRateLimitService } from './application/auth-rate-limit.service';
import { LineChannelBindingService } from './application/line-channel-binding.service';
import { AuthGuard } from './presentation/auth.guard';
import { AuthController } from './presentation/auth.controller';
import { AccessControlModule } from '../access-control/access-control.module';
import { AuditModule } from '../audit/audit.module';
import { AUTH_MAILER_TOKEN } from './domain/ports/auth-mailer.port';
import { DisabledAuthMailerAdapter } from './infrastructure/disabled-auth-mailer.adapter';
import { LocalConsoleAuthMailerAdapter } from './infrastructure/local-console-auth-mailer.adapter';
import { SES_EMAIL_CLIENT_TOKEN, SesAuthMailerAdapter } from './infrastructure/ses-auth-mailer.adapter';
import { AppConfigService } from '../../common/config/app-config.service';
import { LegalAcceptanceService } from './application/legal-acceptance.service';
import { PlatformAccessService } from './application/platform-access.service';
import { PublicPlatformAccessController, SystemPlatformAccessController } from './presentation/platform-access.controller';

type MailerSelectionConfig = Pick<AppConfigService, 'emailProvider' | 'isLocal' | 'sesRegion' | 'sesFromAddress' | 'sesWebBaseUrl'>;

export function selectAuthMailer(
  config: MailerSelectionConfig,
  disabledMailer: DisabledAuthMailerAdapter,
  localConsoleMailer: LocalConsoleAuthMailerAdapter,
  sesMailer: SesAuthMailerAdapter,
) {
  if (config.emailProvider === 'disabled') return disabledMailer;
  if (config.emailProvider === 'local-console') {
    if (!config.isLocal) throw new Error('EMAIL_PROVIDER=local-console is allowed only when APP_ENV=local.');
    return localConsoleMailer;
  }
  if (!config.sesRegion || !config.sesFromAddress || !config.sesWebBaseUrl) {
    throw new Error('EMAIL_PROVIDER=ses requires SES_REGION, SES_FROM_ADDRESS, and WEB_BASE_URL.');
  }
  return sesMailer;
}

// ponytail: JwtModule registered with no default secret; each verifier supplies its own per-call
@Module({
  imports: [JwtModule.register({}), AccessControlModule, AuditModule],
  controllers: [AuthController, PublicPlatformAccessController, SystemPlatformAccessController],
  providers: [
    DevJwtVerifierAdapter,
    WatchdogJwtVerifierAdapter,
    LineLoginVerifierAdapter,
    LineLoginTokenClient,
    ResolveRequestContextUseCase,
    IssueTokenUseCase,
    ExchangeLineTokenUseCase,
    LineLoginCallbackUseCase,
    LineLinkOauthUseCase,
    CreateLineWebLoginTransactionUseCase,
    ApproveLineWebLoginTransactionUseCase,
    RedeemLineWebLoginTransactionUseCase,
    MintLineHandoffTokenUseCase,
    ExchangeLineHandoffTokenUseCase,
    RefreshSessionUseCase,
    LogoutUseCase,
    RevokeOtherSessionsUseCase,
    LinkLineIdentityUseCase,
    UnlinkLineIdentityUseCase,
    CompleteEmployeeLineLinkUseCase,
    PasswordLoginUseCase,
    ChangePasswordUseCase,
    RequestPasswordResetUseCase,
    ConfirmPasswordResetUseCase,
    NotifyPasswordResetRequestUseCase,
    GetAccountSecurityStateUseCase,
    SetAiAssistantPreferenceUseCase,
    RequestEmailChangeUseCase,
    ResendEmailVerificationUseCase,
    ConfirmEmailVerificationUseCase,
    AuthRateLimitService,
    LineChannelBindingService,
    LegalAcceptanceService,
    PlatformAccessService,
    AuthGuard,
    DisabledAuthMailerAdapter,
    LocalConsoleAuthMailerAdapter,
    SesAuthMailerAdapter,
    {
      provide: SES_EMAIL_CLIENT_TOKEN,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => new SESClient({ region: config.sesRegion }),
    },
    {
      provide: AUTH_MAILER_TOKEN,
      inject: [AppConfigService, DisabledAuthMailerAdapter, LocalConsoleAuthMailerAdapter, SesAuthMailerAdapter],
      useFactory: (
        config: AppConfigService,
        disabledMailer: DisabledAuthMailerAdapter,
        localConsoleMailer: LocalConsoleAuthMailerAdapter,
        sesMailer: SesAuthMailerAdapter,
      ) => selectAuthMailer(config, disabledMailer, localConsoleMailer, sesMailer),
    },
  ],
  // P12-3b: `MintLineHandoffTokenUseCase` is exported so the LINE send boundary in `line-ai` can
  // mint at delivery time. Minting stays in ERP Core — the AI Gateway never sees a token.
  // AUTH_MAILER_TOKEN is exported so the P10 claim-email consumer sends through the one selected
  // adapter (disabled / local-console / ses) rather than constructing a second SES client.
  exports: [AuthGuard, ResolveRequestContextUseCase, LineLoginVerifierAdapter, LineChannelBindingService, AuthRateLimitService, LegalAcceptanceService, MintLineHandoffTokenUseCase, AUTH_MAILER_TOKEN],
})
export class AuthModule {}
