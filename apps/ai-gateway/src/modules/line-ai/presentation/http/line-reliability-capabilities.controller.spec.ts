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
