import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AccessControlModule } from '../access-control/access-control.module';
import { BankingModule } from '../banking/banking.module';
import { CrmModule } from '../crm/crm.module';
import { FeatureLaunchModule } from '../feature-launch/feature-launch.module';
import { PrismaAiDraftRepository } from './infrastructure/prisma-ai-draft.repository';
import { LLM_DRAFT_PORT } from './infrastructure/provider/llm-draft.port';
import { createLlmDraftProvider } from './infrastructure/provider/llm-draft-provider.factory';
import { SuggestionGeneratorService } from './application/generators/suggestion-generator.service';
import { SourceDraftAdapterService } from './application/adapters/source-draft-adapter.service';
import { SourceStateService } from './application/source-state.service';
import { CreateDraftRequestUseCase } from './application/use-cases/create-draft-request.use-case';
import { GenerateSuggestionUseCase } from './application/use-cases/generate-suggestion.use-case';
import { DrainDraftRequestsUseCase } from './application/use-cases/drain-draft-requests.use-case';
import {
  ListSuggestionsUseCase,
  GetSuggestionDetailUseCase,
  ListTemplatesUseCase,
  GetProviderStatusUseCase,
} from './application/use-cases/ai-suggestion-query.use-case';
import {
  ValidateCandidateActionUseCase,
  CreateSourceDraftUseCase,
  ReviewSuggestionUseCase,
} from './application/use-cases/ai-suggestion-review.use-case';
import { LineAiSuggestionUseCase } from './application/use-cases/line-ai-suggestion.use-case';
import { AiSuggestionController } from './presentation/http/ai-suggestion.controller';
import { AiTemplateController } from './presentation/http/ai-template.controller';
import { AiDraftInternalController } from './presentation/http/ai-draft-internal.controller';

@Module({
  // FeatureLaunchModule supplies the shadow probe for the draft drain and the direct-injection
  // generate endpoint (plan §3 F1).
  imports: [AuditModule, AccessControlModule, BankingModule, CrmModule, FeatureLaunchModule],
  controllers: [AiSuggestionController, AiTemplateController, AiDraftInternalController],
  providers: [
    PrismaAiDraftRepository,
    { provide: LLM_DRAFT_PORT, useFactory: () => createLlmDraftProvider(process.env) },
    SuggestionGeneratorService,
    SourceDraftAdapterService,
    SourceStateService,
    CreateDraftRequestUseCase,
    GenerateSuggestionUseCase,
    DrainDraftRequestsUseCase,
    ListSuggestionsUseCase,
    GetSuggestionDetailUseCase,
    ListTemplatesUseCase,
    GetProviderStatusUseCase,
    ValidateCandidateActionUseCase,
    CreateSourceDraftUseCase,
    ReviewSuggestionUseCase,
    LineAiSuggestionUseCase,
  ],
  // Exported so Workflow Automation (REQUEST_AI_DRAFT) and LINE can create draft requests.
  exports: [CreateDraftRequestUseCase, LineAiSuggestionUseCase, ListSuggestionsUseCase],
})
export class AiDraftModule {}
