import { Module } from '@nestjs/common';
import { AiModule } from '../../common/ai/ai.module';
import { ErpToolClient } from './infrastructure/erp-tool.client';
import { OrchestratorAgent } from './agents/orchestrator.agent';
import { AgentCoreRuntimeClient } from './infrastructure/runtime/agentcore-runtime.client';
import { LineAiTurnUseCase } from './application/use-cases/line-ai-turn.use-case';
import { LineAiInternalController } from './presentation/http/line-ai-internal.controller';
import { LineReliabilityCapabilitiesController } from './presentation/http/line-reliability-capabilities.controller';
import { DocumentQaController } from './presentation/http/document-qa.controller';
import { DocumentQaUseCase } from './application/document-qa.use-case';

@Module({
  imports: [AiModule],
  controllers: [LineAiInternalController, LineReliabilityCapabilitiesController, DocumentQaController],
  providers: [ErpToolClient, OrchestratorAgent, AgentCoreRuntimeClient, LineAiTurnUseCase, DocumentQaUseCase],
})
export class LineAiModule {}
