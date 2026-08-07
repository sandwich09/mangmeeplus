import { Module } from '@nestjs/common';
import { CreateCompanyOnboardingUseCase } from './application/use-cases/create-company-onboarding.use-case';
import { GetCompanyOnboardingUseCase } from './application/use-cases/get-company-onboarding.use-case';
import { RegenerateTemporaryPasswordUseCase } from './application/use-cases/regenerate-temporary-password.use-case';
import { ReissueOwnerLineLinkUseCase } from './application/use-cases/reissue-owner-line-link.use-case';
import { SystemOnboardingController } from './presentation/http/system-onboarding.controller';

@Module({
  controllers: [SystemOnboardingController],
  providers: [
    CreateCompanyOnboardingUseCase,
    GetCompanyOnboardingUseCase,
    RegenerateTemporaryPasswordUseCase,
    ReissueOwnerLineLinkUseCase,
  ],
})
export class SystemOnboardingModule {}
