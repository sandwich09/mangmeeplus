import type { AiGatewayConfigService } from '../../../../common/config/ai-gateway-config.service';
import type { IModelProvider } from './provider.port';
import { BedrockProvider } from './bedrock.provider';
import { DisabledProvider } from './disabled.provider';
import { OpenAiProvider } from './openai.provider';

export function createProvider(
  config: AiGatewayConfigService,
  // Per-workload override (owner decision 2026-07-14): document understanding may use a
  // stronger model and a longer timeout than chat/tool calls; unset falls back to defaults.
  opts?: { modelId?: string; timeoutMs?: number },
): IModelProvider {
  const timeoutMs = opts?.timeoutMs ?? config.aiToolTimeoutMs;
  if (config.modelProvider === 'openai') {
    const apiKey = config.openAiApiKey;
    if (!apiKey) return new DisabledProvider();
    const modelId = opts?.modelId ?? config.openAiModel;
    assertApproved(config, 'openai', modelId, config.openAiProcessingRegion);
    return new OpenAiProvider({ apiKey, model: modelId, timeoutMs });
  }
  if (config.modelProvider === 'bedrock') {
    const region = config.bedrockRegion;
    const modelId = opts?.modelId ?? config.bedrockModelId;
    // ponytail: fail safe with DisabledProvider if Bedrock is misconfigured
    if (!region || !modelId) return new DisabledProvider();
    assertApproved(config, 'bedrock', modelId, region);
    return new BedrockProvider({ region, modelId, timeoutMs });
  }
  return new DisabledProvider();
}

function assertApproved(
  config: AiGatewayConfigService,
  provider: string,
  modelId: string,
  region: string | undefined,
): void {
  // A few focused unit stubs predate the policy getters. Real config always exposes them.
  const approvedProviders = config.approvedAiProviders;
  const approvedModels = config.approvedAiModelIds;
  const approvedRegions = config.approvedAiRegions;
  if (approvedProviders && !approvedProviders.includes(provider)) throw new Error('AI_PROVIDER_NOT_APPROVED');
  if (approvedModels && !approvedModels.includes(modelId)) throw new Error('AI_MODEL_NOT_APPROVED');
  if (approvedRegions && (!region || !approvedRegions.includes(region))) throw new Error('AI_REGION_NOT_APPROVED');
}
