import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LineReliabilityCapabilitiesController } from './line-reliability-capabilities.controller';
import * as runtime from '../../../../common/usage/ai-budget-provider';
const config = { aiGatewayInternalSecret: 'synthetic-secret', modelProvider: 'openai', openAiModel: 'gpt-4.1-mini',
  openAiProcessingRegion: 'global', openAiApiKey: 'synthetic-key', approvedAiProviders: ['openai', 'bedrock'],
  approvedAiModelIds: ['gpt-4.1-mini', 'apac.anthropic.claude-3-haiku-20240307-v1:0'], approvedAiRegions: ['global', 'ap-southeast-1'], bedrockRegion: 'ap-southeast-1' };
const turn = { lineBudgetV2CapabilityEnabled: async () => true } as never;
test('capability negotiation authenticates first and never asserts unknown or mismatched vendor capacity', async () => {
  const controller = new LineReliabilityCapabilitiesController(config as never, turn);
  await assert.rejects(() => controller.capabilities(undefined, {}), /Invalid internal secret/);
  await assert.rejects(() => controller.capabilities('wrong', {}), /Invalid internal secret/);
  for (const modelId of ['unknown', 'gpt-4.1-mini-invented', 'apac.anthropic.claude-3-haiku-20240307-v1:0']) {
    const result = await controller.capabilities(config.aiGatewayInternalSecret, { modelPolicy: { modelId } });
    assert.equal(result.ready, false); assert.equal(result.model, undefined);
  }
});
test('capability negotiation requires actual compiled runtime support plus current model/provider/region approvals', async () => {
  const result = await new LineReliabilityCapabilitiesController(config as never, turn).capabilities(config.aiGatewayInternalSecret, {});
  assert.equal(result.ready, (runtime as unknown as { AI_BUDGET_V2_SUPPORTED?: boolean }).AI_BUDGET_V2_SUPPORTED === true);
  if (result.ready) assert.deepEqual(result.model, { provider: 'openai', modelId: 'gpt-4.1-mini', region: 'global', contextTokens: 1047576, maxOutputTokens: 32768 });
  for (const patch of [{ approvedAiProviders: [] }, { approvedAiRegions: [] }, { approvedAiModelIds: [] }, { openAiApiKey: '' }]) {
    assert.equal((await new LineReliabilityCapabilitiesController({ ...config, ...patch } as never, turn).capabilities(config.aiGatewayInternalSecret, {})).ready, false);
  }
});

test('an unready downstream artifact never becomes a ready gateway capability', async () => {
  const stale = new LineReliabilityCapabilitiesController(config as never, { lineBudgetV2CapabilityEnabled: async () => false } as never);
  assert.equal((await stale.capabilities(config.aiGatewayInternalSecret, {})).ready, false);
});

test('the deployed Sonnet 4.6 profile requires named global approval and every existing readiness gate', async () => {
  const modelId = 'global.anthropic.claude-sonnet-4-6';
  const deployed = { ...config, modelProvider: 'bedrock', bedrockModelId: modelId,
    approvedAiModelIds: [modelId], aiGlobalInferenceProfileApproved: true,
    aiGlobalInferenceProfileApprovalRef: 'synthetic-approved-resolution' };
  const result = await new LineReliabilityCapabilitiesController(deployed as never, turn)
    .capabilities(config.aiGatewayInternalSecret, {});
  assert.equal(result.ready, true);
  assert.deepEqual(result.model, { provider: 'bedrock', modelId, region: 'ap-southeast-1',
    contextTokens: 200_000, maxOutputTokens: 64_000 });
  for (const patch of [
    { aiGlobalInferenceProfileApproved: false }, { aiGlobalInferenceProfileApprovalRef: undefined },
    { aiGlobalInferenceProfileApprovalRef: '   ' }, { approvedAiProviders: [] },
    { approvedAiModelIds: [] }, { approvedAiRegions: [] }, { modelProvider: 'openai', openAiModel: modelId },
    { bedrockModelId: `${modelId}-invented`, approvedAiModelIds: [`${modelId}-invented`] },
  ]) {
    const denied = await new LineReliabilityCapabilitiesController({ ...deployed, ...patch } as never, turn)
      .capabilities(config.aiGatewayInternalSecret, {});
    assert.equal(denied.ready, false, JSON.stringify(patch));
    assert.equal(denied.model, undefined);
  }
  assert.equal((await new LineReliabilityCapabilitiesController(deployed as never,
    { lineBudgetV2CapabilityEnabled: async () => false } as never)
    .capabilities(config.aiGatewayInternalSecret, {})).ready, false);
});
