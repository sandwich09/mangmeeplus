import { AI_BUDGET_STEP_ATTEMPTS } from '@watchdog-bms/contracts';
import type { AiGatewayConfigService } from '../../../../common/config/ai-gateway-config.service';
import type { IModelProvider } from './provider.port';
import { BedrockProvider } from './bedrock.provider';
import { DisabledProvider } from './disabled.provider';
import { OpenAiProvider } from './openai.provider';
import { withAiBudgetEnvelope } from '../../../../common/usage/ai-budget-provider';
import { createAiBudgetSeam } from '../../../../common/usage/ai-budget-seam';
import { currentBudgetEnvelope, currentBudgetGrantV2, currentBudgetState, currentUsageCompanyId } from '../../../../common/usage/usage-context';

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
  const grant = currentBudgetGrantV2();
  const envelopeModelId = currentBudgetEnvelope()?.modelId ?? grant?.model.modelId;
  const budgetActive = currentBudgetState()?.status === 'active' || currentBudgetState()?.status === 'active-v2';
  const provider = grant?.model.provider ?? config.modelProvider;
  const modelId = grant?.model.modelId ?? opts?.modelId ?? envelopeModelId;
  if (provider === 'openai') {
    const apiKey = config.openAiApiKey;
    const selectedModel = modelId ?? config.openAiModel;
    if (!apiKey || (grant && config.openAiProcessingRegion !== grant.model.region)) return new DisabledProvider();
    assertApproved(config, 'openai', selectedModel, grant?.model.region ?? config.openAiProcessingRegion);
    return budgeted(config, selectedModel, new OpenAiProvider({ apiKey, model: selectedModel, timeoutMs }));
  }
  if (provider === 'bedrock') {
    const region = grant?.model.region ?? config.bedrockRegion;
    const selectedModel = modelId ?? config.bedrockModelId;
    // The signed grant pins all three provider coordinates; never drift to deployment defaults.
    if (!region || !selectedModel || (grant && config.bedrockRegion !== grant.model.region)) return new DisabledProvider();
    assertApproved(config, 'bedrock', selectedModel, region);
    return budgeted(config, selectedModel, new BedrockProvider({
      region,
      modelId: selectedModel,
      timeoutMs,
      // ADR 0013 §6 step 3: the reservation prices exactly one SDK attempt, so under an envelope
      // the client is pinned to it — a silent SDK retry would spend a second invocation's money
      // against one hold. Absent without an envelope, which leaves today's SDK default untouched.
      ...(budgetActive ? { maxAttempts: grant ? 1 : AI_BUDGET_STEP_ATTEMPTS } : {}),
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
