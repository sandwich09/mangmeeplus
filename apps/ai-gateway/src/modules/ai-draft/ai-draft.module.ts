import { Module } from '@nestjs/common';
import { AiModule } from '../../common/ai/ai.module';
import { AiDraftInternalController } from './ai-draft-internal.controller';
import { GenerateDraftUseCase } from './generate-draft.use-case';

@Module({
  imports: [AiModule],
  controllers: [AiDraftInternalController],
  providers: [GenerateDraftUseCase],
})
export class AiDraftModule {}
