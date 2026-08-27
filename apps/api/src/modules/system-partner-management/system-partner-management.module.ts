import { Module } from '@nestjs/common';
import { PartnerController } from './presentation/http/partner.controller';
import { SystemLineController } from './presentation/http/system-line.controller';
import { SystemAiBudgetController } from './presentation/http/system-ai-budget.controller';
import { ListPartnersUseCase } from './application/use-cases/list-partners.use-case';
import { GetPartnerDetailUseCase } from './application/use-cases/get-partner-detail.use-case';
import { UpdatePartnerProfileUseCase } from './application/use-cases/update-partner-profile.use-case';
import { PartnerLifecycleTransitionUseCase } from './application/use-cases/partner-lifecycle-transition.use-case';
import { SetPartnerFeaturesUseCase } from './application/use-cases/set-partner-features.use-case';
import { SetPartnerAiModelUseCase } from './application/use-cases/set-partner-ai-model.use-case';
import { SetPartnerOcrConfigUseCase } from './application/use-cases/set-partner-ocr-config.use-case';
import { GetPartnerAiUsageUseCase } from './application/use-cases/get-partner-ai-usage.use-case';
import { GetPlatformAiBudgetUseCase } from './application/use-cases/get-platform-ai-budget.use-case';
import { SetPlatformAiBudgetUseCase } from './application/use-cases/set-platform-ai-budget.use-case';
import { SetPartnerLineCredentialUseCase } from './application/use-cases/set-partner-line-credential.use-case';
import { SetSharedLineCredentialUseCase } from './application/use-cases/set-shared-line-credential.use-case';
import { ListPartnerMembersUseCase } from './application/use-cases/list-partner-members.use-case';
import { PartnerMemberLineUnlinkUseCase } from './application/use-cases/partner-member-line-unlink.use-case';
import { PartnerMemberPasswordResetUseCase } from './application/use-cases/partner-member-password-reset.use-case';
import { PartnerMemberPasswordRevealUseCase } from './application/use-cases/partner-member-password-reveal.use-case';
import { DataModelCoreModule } from '../data-model-core/data-model-core.module';
import { LedgerModule } from '../ledger/ledger.module.js';

@Module({
  imports: [LedgerModule, DataModelCoreModule],
  controllers: [PartnerController, SystemLineController, SystemAiBudgetController],
  providers: [
    ListPartnersUseCase,
    GetPartnerDetailUseCase,
    UpdatePartnerProfileUseCase,
    PartnerLifecycleTransitionUseCase,
    SetPartnerFeaturesUseCase,
    SetPartnerAiModelUseCase,
    SetPartnerOcrConfigUseCase,
    GetPartnerAiUsageUseCase,
    GetPlatformAiBudgetUseCase,
    SetPlatformAiBudgetUseCase,
    SetPartnerLineCredentialUseCase,
    SetSharedLineCredentialUseCase,
    ListPartnerMembersUseCase,
    PartnerMemberLineUnlinkUseCase,
    PartnerMemberPasswordResetUseCase,
    PartnerMemberPasswordRevealUseCase,
  ],
})
export class SystemPartnerManagementModule {}
