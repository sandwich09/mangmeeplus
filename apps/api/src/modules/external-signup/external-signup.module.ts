import { Module } from '@nestjs/common';
import { LoggerModule } from '../../common/logger/logger.module';
import { AuthModule } from '../auth/auth.module';
import { DashboardNotificationsModule } from '../dashboard-notifications/dashboard-notifications.module';
import { DataModelCoreModule } from '../data-model-core/data-model-core.module';
import { SystemOnboardingModule } from '../system-onboarding/system-onboarding.module';
import { CompanySignupCoreService } from './application/company-signup-core.service';
import { SignupAdminNotifyService } from './application/signup-admin-notify.service';
import { AccountClaimTokenService } from './application/account-claim-token.service';
import { PublicSignupStatusUseCase } from './application/public-signup-status.use-case';
import { ProvisionSignupUseCase } from './application/provision-signup.use-case';
import { SignupAdminQueueUseCase } from './application/signup-admin-queue.use-case';
import { SignupClaimEmailService } from './application/signup-claim-email.service';
import { SignupClaimUseCase } from './application/signup-claim.use-case';
import { SubmitCompanySignupUseCase } from './application/submit-company-signup.use-case';
import { PublicCompanySignupController } from './presentation/http/public-company-signup.controller';
import { SignupClaimEmailInternalController } from './presentation/http/signup-claim-email-internal.controller';
import { SystemSignupRequestController } from './presentation/http/system-signup-request.controller';

@Module({
  // AuthModule: the rate limiter and the mailer port. DataModelCoreModule: the outbox repository.
  // SystemOnboardingModule: the one service allowed to create a company (spec §2 rule 5).
  // LoggerModule: LOGGER_TOKEN for the claim-email send-failure event.
  // DashboardNotificationsModule: the notification event use case the admin announcement reuses.
  imports: [AuthModule, DashboardNotificationsModule, DataModelCoreModule, SystemOnboardingModule, LoggerModule],
  controllers: [
    PublicCompanySignupController,
    SystemSignupRequestController,
    SignupClaimEmailInternalController,
  ],
  providers: [
    CompanySignupCoreService,
    AccountClaimTokenService,
    SubmitCompanySignupUseCase,
    PublicSignupStatusUseCase,
    SignupClaimUseCase,
    ProvisionSignupUseCase,
    SignupAdminQueueUseCase,
    SignupAdminNotifyService,
    SignupClaimEmailService,
  ],
  exports: [CompanySignupCoreService],
})
export class ExternalSignupModule {}
