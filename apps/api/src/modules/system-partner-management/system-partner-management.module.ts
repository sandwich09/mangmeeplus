import { Module } from '@nestjs/common';
import { PartnerController } from './presentation/http/partner.controller';
import { SystemLineController } from './presentation/http/system-line.controller';
import { SystemAiBudgetController } from './presentation/http/system-ai-budget.controller';
import { SystemUserLookupController } from './presentation/http/system-user-lookup.controller';
import { LookupUsersUseCase } from './application/use-cases/lookup-users.use-case';
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
import { SetPartnerMemberContactUseCase } from './application/use-cases/set-partner-member-contact.use-case';
import { PartnerMemberPasswordResetUseCase } from './application/use-cases/partner-member-password-reset.use-case';
import { PartnerMemberPasswordRevealUseCase } from './application/use-cases/partner-member-password-reveal.use-case';
import { PartnerMemberLineLinkTokenUseCase } from './application/use-cases/partner-member-line-link-token.use-case';
import { DataModelCoreModule } from '../data-model-core/data-model-core.module';
import { LedgerModule } from '../ledger/ledger.module.js';
import { DashboardNotificationsModule } from '../dashboard-notifications/dashboard-notifications.module';
import { PlanTermInternalController, PlanTermNoticeController } from './presentation/http/plan-term.controller';
import {
  GetCompanyPlanTermUseCase,
  GetPlanTermNoticeUseCase,
  RenewCompanyPlanTermUseCase,
  SetCompanyPlanTermUseCase,
} from './application/use-cases/company-plan-term.use-cases';
import { PlanTermSweepUseCase } from './application/use-cases/plan-term-sweep.use-case';

@Module({
  // DashboardNotificationsModule supplies CreateOrUpdateNotificationEventUseCase for the P29
  // warning ladder and expiry notices (WEB + LINE, owners and system admins).
  imports: [LedgerModule, DataModelCoreModule, DashboardNotificationsModule],
  controllers: [
    PartnerController,
    SystemLineController,
    SystemAiBudgetController,
    SystemUserLookupController,
    PlanTermNoticeController,
    PlanTermInternalController,
  ],
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
    LookupUsersUseCase,
    PartnerMemberLineUnlinkUseCase,
    SetPartnerMemberContactUseCase,
    PartnerMemberPasswordResetUseCase,
    PartnerMemberPasswordRevealUseCase,
    PartnerMemberLineLinkTokenUseCase,
    GetCompanyPlanTermUseCase,
    SetCompanyPlanTermUseCase,
    RenewCompanyPlanTermUseCase,
    GetPlanTermNoticeUseCase,
    PlanTermSweepUseCase,
  ],
  // Signup provisioning (P10 Slice C) calls setTermFromPreset on this use-case.
  exports: [SetCompanyPlanTermUseCase],
})
export class SystemPartnerManagementModule {}
