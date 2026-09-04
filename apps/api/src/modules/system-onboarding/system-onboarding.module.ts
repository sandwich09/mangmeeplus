import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CreateCompanyOnboardingUseCase } from './application/use-cases/create-company-onboarding.use-case';
import { GetCompanyOnboardingUseCase } from './application/use-cases/get-company-onboarding.use-case';
import { RegenerateTemporaryPasswordUseCase } from './application/use-cases/regenerate-temporary-password.use-case';
import { ReissueOwnerLineLinkUseCase } from './application/use-cases/reissue-owner-line-link.use-case';
import { SystemOnboardingController } from './presentation/http/system-onboarding.controller';

@Module({
  // AuthModule: `LegalAcceptanceService`, so LIFF clickwrap evidence is replayed inside the same
  // company-creation transaction rather than by a second writer afterwards (LEGAL-LIFF-01).
  imports: [AuthModule],
  controllers: [SystemOnboardingController],
  providers: [
    CreateCompanyOnboardingUseCase,
    GetCompanyOnboardingUseCase,
    RegenerateTemporaryPasswordUseCase,
    ReissueOwnerLineLinkUseCase,
  ],
  // Exported for the P10 signup provisioning path: company creation has exactly one owner service
  // (spec §2 rule 5), so the claim flow reuses this rather than growing a second one.
  exports: [CreateCompanyOnboardingUseCase],
})
export class SystemOnboardingModule {}
