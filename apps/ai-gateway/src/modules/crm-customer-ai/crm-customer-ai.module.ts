import { Module } from '@nestjs/common';
import { AiModule } from '../../common/ai/ai.module';
import { CrmCustomerAiInternalController } from './crm-customer-ai-internal.controller';
import { CrmBookingExtractUseCase } from './use-cases/crm-booking-extract.use-case';
import { CrmIntakeUseCase } from './use-cases/crm-intake.use-case';
import { CrmReplyDraftUseCase } from './use-cases/crm-reply-draft.use-case';
import { CrmTrustScoreUseCase } from './use-cases/crm-trust-score.use-case';
import { CrmSummaryUseCase } from './use-cases/crm-summary.use-case';
import { CrmInsightsUseCase } from './use-cases/crm-insights.use-case';
import { CrmCustomerProfileExtractUseCase } from './use-cases/crm-customer-profile-extract.use-case';
import { CrmBroadcastUseCase } from './use-cases/crm-broadcast.use-case';

// CRM customer-facing AI family (spec §25). Registered in the gateway AppModule and
// NEVER imported by LineAiModule (or vice versa). Shares only the provider port/factory
// under line-ai/infrastructure/provider — no agents, prompts, tools, or ERP tool client.
@Module({
  imports: [AiModule],
  controllers: [CrmCustomerAiInternalController],
  providers: [
    CrmBookingExtractUseCase,
    CrmIntakeUseCase,
    CrmReplyDraftUseCase,
    CrmTrustScoreUseCase,
    CrmSummaryUseCase,
    CrmInsightsUseCase,
    CrmCustomerProfileExtractUseCase,
    CrmBroadcastUseCase,
  ],
})
export class CrmCustomerAiModule {}
