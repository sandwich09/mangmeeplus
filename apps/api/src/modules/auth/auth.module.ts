import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { DevJwtVerifierAdapter } from './infrastructure/dev-jwt-verifier.adapter';
import { WatchdogJwtVerifierAdapter } from './infrastructure/watchdog-jwt-verifier.adapter';
import { LineLoginVerifierAdapter } from './infrastructure/line-login-verifier.adapter';
import { ResolveRequestContextUseCase } from './application/use-cases/resolve-request-context.use-case';
import { IssueTokenUseCase } from './application/use-cases/issue-token.use-case';
import { ExchangeLineTokenUseCase } from './application/use-cases/exchange-line-token.use-case';
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
import { AppConfigService } from '../../common/config/app-config.service';
import { LegalAcceptanceService } from './application/legal-acceptance.service';

// ponytail: JwtModule registered with no default secret; each verifier supplies its own per-call
@Module({
  imports: [JwtModule.register({}), AccessControlModule, AuditModule],
  controllers: [AuthController],
  providers: [
    DevJwtVerifierAdapter,
    WatchdogJwtVerifierAdapter,
    LineLoginVerifierAdapter,
    ResolveRequestContextUseCase,
    IssueTokenUseCase,
    ExchangeLineTokenUseCase,
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
    AuthGuard,
    DisabledAuthMailerAdapter,
    LocalConsoleAuthMailerAdapter,
    {
      provide: AUTH_MAILER_TOKEN,
      inject: [AppConfigService, DisabledAuthMailerAdapter, LocalConsoleAuthMailerAdapter],
      useFactory: (
        config: AppConfigService,
        disabledMailer: DisabledAuthMailerAdapter,
        localConsoleMailer: LocalConsoleAuthMailerAdapter,
      ) => {
        if (config.emailProvider === 'ses') {
          throw new Error('EMAIL_PROVIDER=ses is not implemented yet in this workspace.');
        }
        return config.isLocal ? localConsoleMailer : disabledMailer;
      },
    },
  ],
  exports: [AuthGuard, ResolveRequestContextUseCase, LineLoginVerifierAdapter, LineChannelBindingService, AuthRateLimitService, LegalAcceptanceService],
})
export class AuthModule {}
