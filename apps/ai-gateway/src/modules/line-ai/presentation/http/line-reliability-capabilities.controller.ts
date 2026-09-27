import { Body, Controller, Headers, HttpCode, Post } from '@nestjs/common';
import { AI_BUDGET_ESTIMATOR_VERSION_V2, AI_BUDGET_PROFILE_TABLE_DIGEST_V2 } from '@watchdog-bms/contracts';
import { AiGatewayConfigService } from '../../../../common/config/ai-gateway-config.service';
import { assertInternalSecret } from '../../../../common/security/internal-secret';
import { Public } from '../../../../common/security/public.decorator';
import * as budgetRuntime from '../../../../common/usage/ai-budget-provider';
import { LineAiTurnUseCase } from '../../application/use-cases/line-ai-turn.use-case';

import { REVIEWED_LINE_MODEL_CAPACITY } from '../../infrastructure/provider/reviewed-line-model-capacity';

@Public()
@Controller('internal/ai')
export class LineReliabilityCapabilitiesController {
  constructor(private readonly config: AiGatewayConfigService, private readonly turnUseCase: LineAiTurnUseCase) {}

  @Post('line-reliability-capabilities')
  @HttpCode(200)
  async capabilities(@Headers('x-internal-secret') secret: string | undefined,
    @Body() body: { modelPolicy?: { modelId?: unknown } }) {
    assertInternalSecret(secret, this.config.aiGatewayInternalSecret);
    const provider = this.config.modelProvider;
    const modelId = body?.modelPolicy?.modelId ?? (provider === 'openai' ? this.config.openAiModel : this.config.bedrockModelId);
    const region = provider === 'openai' ? this.config.openAiProcessingRegion : this.config.bedrockRegion;
    const capacity = typeof modelId === 'string' ? REVIEWED_LINE_MODEL_CAPACITY[modelId] : undefined;
    const globalProfileAllowed = this.config.aiGlobalInferenceProfileApproved === true
      && !!this.config.aiGlobalInferenceProfileApprovalRef?.trim();
    const runtime = budgetRuntime as unknown as { AI_BUDGET_V2_SUPPORTED?: boolean };
    const ready = runtime.AI_BUDGET_V2_SUPPORTED === true
      && (provider === 'bedrock' || provider === 'openai' && !!this.config.openAiApiKey)
      && typeof modelId === 'string' && !!region && !!capacity
      && (provider === 'bedrock'
        ? modelId.startsWith('apac.anthropic.') || modelId.startsWith('global.anthropic.') && globalProfileAllowed
        : modelId.startsWith('gpt-4.1-mini'))
      && this.config.approvedAiProviders.includes(provider)
      && this.config.approvedAiModelIds.includes(modelId)
      && this.config.approvedAiRegions.includes(region)
      && await this.turnUseCase.lineBudgetV2CapabilityEnabled();
    return {
      ready, inputContractVersion: 2, providerOutputVersion: 2, budgetContractVersion: 2,
      profileTableDigest: AI_BUDGET_PROFILE_TABLE_DIGEST_V2, estimatorVersion: AI_BUDGET_ESTIMATOR_VERSION_V2,
      ...(ready ? { model: { provider, modelId, region, ...capacity } } : {}),
    };
  }
}
