import { AI_BUDGET_STEP_ATTEMPTS } from '@watchdog-bms/contracts';
import type { AiGatewayConfigService } from '../../../../common/config/ai-gateway-config.service';
import type { IModelProvider } from './provider.port';
import { BedrockProvider } from './bedrock.provider';
import { DisabledProvider } from './disabled.provider';
import { OpenAiProvider } from './openai.provider';
import { withAiBudgetEnvelope } from '../../../../common/usage/ai-budget-provider';
import { createAiBudgetSeam } from '../../../../common/usage/ai-budget-seam';
import { currentBudgetEnvelope, currentUsageCompanyId } from '../../../../common/usage/usage-context';

export function createProvider(
  config: AiGatewayConfigService,
  // Per-workload override (owner decision 2026-07-14): document understanding may use a
  // stronger model and a longer timeout than chat/tool calls; unset falls back to defaults.
  opts?: { modelId?: string; timeoutMs?: number },
): IModelProvider {
  const timeoutMs = opts?.timeoutMs ?? config.aiToolTimeoutMs;
  // Under a SPLIT envelope the model the MONEY was reserved for wins over the deployment default,
  // for a route whose caller passes no per-request policy (`draft-generate`). Any other model is
  // refused by the guard below anyway, so preferring the envelope's turns a guaranteed
  // `model_mismatch` into the call the reservation actually priced. Unset without an envelope, so
  // every SHARED request keeps the exact model it picks today.
  const envelopeModelId = currentBudgetEnvelope()?.modelId;
  if (config.modelProvider === 'openai') {
    const apiKey = config.openAiApiKey;
    if (!apiKey) return new DisabledProvider();
    const modelId = opts?.modelId ?? envelopeModelId ?? config.openAiModel;
    assertApproved(config, 'openai', modelId, config.openAiProcessingRegion);
    return budgeted(config, modelId, new OpenAiProvider({ apiKey, model: modelId, timeoutMs }));
  }
  if (config.modelProvider === 'bedrock') {
    const region = config.bedrockRegion;
    const modelId = opts?.modelId ?? envelopeModelId ?? config.bedrockModelId;
    // ponytail: fail safe with DisabledProvider if Bedrock is misconfigured
    if (!region || !modelId) return new DisabledProvider();
    assertApproved(config, 'bedrock', modelId, region);
    return budgeted(config, modelId, new BedrockProvider({
      region,
      modelId,
      timeoutMs,
      // ADR 0013 §6 step 3: the reservation prices exactly one SDK attempt, so under an envelope
      // the client is pinned to it — a silent SDK retry would spend a second invocation's money
      // against one hold. Absent without an envelope, which leaves today's SDK default untouched.
      ...(currentBudgetEnvelope() ? { maxAttempts: AI_BUDGET_STEP_ATTEMPTS } : {}),
    }));
  }
  return new DisabledProvider();
}

/**
 * The single choke point where money enforcement is applied (ADR 0013 §6). A pure pass-through
 * when the request context carries no envelope, so every SHARED company — that is, every company
 * today — reaches the provider with byte-identical input.
 *
 * `DisabledProvider` is deliberately NOT wrapped: it makes no provider call and can spend nothing,
 * so budget-stepping or settling it would invent an invocation that never happened.
 */
function budgeted(config: AiGatewayConfigService, modelId: string, provider: IModelProvider): IModelProvider {
  return withAiBudgetEnvelope(provider, {
    modelId,
    companyId: currentUsageCompanyId(),
    seam: createAiBudgetSeam(
      {
        baseUrl: config.erpCoreInternalUrl,
        secret: config.aiGatewayInternalSecret,
        timeoutMs: config.aiToolTimeoutMs,
      },
      (line) => console.warn(JSON.stringify(line)),
    ),
    log: (line) => console.warn(JSON.stringify(line)),
  });
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
