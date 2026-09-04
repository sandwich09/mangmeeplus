import { Module } from '@nestjs/common';
import { LoggerModule } from '../../common/logger/logger.module';
import { AuthModule } from '../auth/auth.module';
import { DashboardNotificationsModule } from '../dashboard-notifications/dashboard-notifications.module';
import { DataModelCoreModule } from '../data-model-core/data-model-core.module';
import { SystemOnboardingModule } from '../system-onboarding/system-onboarding.module';
import { CompanySignupCoreService } from './application/company-signup-core.service';
import { SignupAdminNotifyService } from './application/signup-admin-notify.service';
import { LineSignupNotifyService } from './application/line-signup-notify.service';
import { AccountClaimTokenService } from './application/account-claim-token.service';
import { PublicSignupStatusUseCase } from './application/public-signup-status.use-case';
import { ProvisionSignupUseCase } from './application/provision-signup.use-case';
import { SignupAdminQueueUseCase } from './application/signup-admin-queue.use-case';
import { SignupClaimEmailService } from './application/signup-claim-email.service';
import { SignupClaimUseCase } from './application/signup-claim.use-case';
import { SubmitCompanySignupUseCase } from './application/submit-company-signup.use-case';
import { SubmitLineSignupUseCase } from './application/submit-line-signup.use-case';
import { GetLineSignupStatusUseCase } from './application/get-line-signup-status.use-case';
import { PackageChangeRequestUseCase } from './application/package-change-request.use-case';
import { SesEventsUseCase, SNS_HTTP_GET_TOKEN } from './application/ses-event.use-case';
import { fetchSnsText } from './infrastructure/sns-signature';
import { CompanyPackageChangeController } from './presentation/http/company-package-change.controller';
import { PublicCompanySignupController } from './presentation/http/public-company-signup.controller';
import { PublicLineSignupController } from './presentation/http/public-line-signup.controller';
import { PublicSesEventsController } from './presentation/http/public-ses-events.controller';
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
    PublicLineSignupController,
    PublicSesEventsController,
    SystemSignupRequestController,
    CompanyPackageChangeController,
    SignupClaimEmailInternalController,
  ],
  providers: [
    CompanySignupCoreService,
    AccountClaimTokenService,
    SubmitCompanySignupUseCase,
    SubmitLineSignupUseCase,
    GetLineSignupStatusUseCase,
    PackageChangeRequestUseCase,
    PublicSignupStatusUseCase,
    SignupClaimUseCase,
    ProvisionSignupUseCase,
    SignupAdminQueueUseCase,
    SignupAdminNotifyService,
    LineSignupNotifyService,
    SignupClaimEmailService,
    SesEventsUseCase,
    // The one outbound GET the SNS path makes (signing certificate, subscription confirmation),
    // injected like the SES client is, so a spec can drive it without network.
    { provide: SNS_HTTP_GET_TOKEN, useValue: fetchSnsText },
  ],
  // P10-L: the LINE webhook opens package-change requests and announces support requests, so those
  // two travel out of this module. Nothing else does — company creation stays behind the queue.
  exports: [CompanySignupCoreService, PackageChangeRequestUseCase, LineSignupNotifyService],
})
export class ExternalSignupModule {}
