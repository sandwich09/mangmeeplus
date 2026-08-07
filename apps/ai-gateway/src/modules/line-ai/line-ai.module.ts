import { Module } from '@nestjs/common';
import { AiModule } from '../../common/ai/ai.module';
import { ErpToolClient } from './infrastructure/erp-tool.client';
import { OrchestratorAgent } from './agents/orchestrator.agent';
import { AgentCoreRuntimeClient } from './infrastructure/runtime/agentcore-runtime.client';
import { LineAiTurnUseCase } from './application/use-cases/line-ai-turn.use-case';
import { LineAiInternalController } from './presentation/http/line-ai-internal.controller';

@Module({
  imports: [AiModule],
  controllers: [LineAiInternalController],
  providers: [ErpToolClient, OrchestratorAgent, AgentCoreRuntimeClient, LineAiTurnUseCase],
})
export class LineAiModule {}
