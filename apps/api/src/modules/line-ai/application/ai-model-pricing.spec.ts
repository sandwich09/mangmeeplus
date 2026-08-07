import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AI_MODEL_PRICES, computeCostSatang, resolveAiModelPrices } from './ai-model-pricing';

const entry = (over: Partial<Parameters<typeof computeCostSatang>[0]> = {}) => ({
  modelId: 'apac.anthropic.claude-3-5-sonnet-20241022-v2:0',
  inputTokens: 0,
  outputTokens: 0,
  cacheReadInputTokens: 0,
  cacheWriteInputTokens: 0,
  ...over,
});

describe('ai model pricing', () => {
  it('prices a realistic Sonnet call against the pinned map at AI_THB_PER_USD=33', () => {
    // (10000·3 + 2000·15 + 50000·0.30 + 8000·3.75) USD/MTok = 105_000
    // 105_000 / 1e6 × 33 × 100 = 346.5 satang → 347 (half up)
    const { costSatang, unknownModel } = computeCostSatang(
      entry({ inputTokens: 10_000, outputTokens: 2_000, cacheReadInputTokens: 50_000, cacheWriteInputTokens: 8_000 }),
      33,
    );

    assert.equal(costSatang, 347);
    assert.equal(unknownModel, false);
  });

  it('rounds half up, not to even', () => {
    // 12000 cache-write tokens × 3.75 = 45_000; × 1 THB/USD × 100 / 1e6 = exactly 4.5
    const { costSatang } = computeCostSatang(entry({ cacheWriteInputTokens: 12_000 }), 1);

    assert.equal(costSatang, 5); // banker's rounding would give 4
  });

  it('matches a model id by substring, so provider prefixes and versions need no map row', () => {
    assert.equal(resolveAiModelPrices('global.anthropic.claude-sonnet-4-6').known, true);
    assert.deepEqual(
      resolveAiModelPrices('global.anthropic.claude-sonnet-4-6').prices,
      resolveAiModelPrices('apac.anthropic.claude-3-5-sonnet-20241022-v2:0').prices,
    );
  });

  it('costs an unknown model at the highest configured price and flags it — never 0', () => {
    const unknown = computeCostSatang(entry({ modelId: 'some.unlisted-model-v9', inputTokens: 1_000_000 }), 33);
    const maxInput = Math.max(...AI_MODEL_PRICES.map(([, p]) => p.input));

    assert.equal(unknown.unknownModel, true);
    assert.ok(unknown.costSatang > 0, 'an unpriced model must never record as free');
    assert.equal(unknown.costSatang, Math.round((1_000_000 * maxInput * 33 * 100) / 1_000_000));
    // and it over-counts rather than under-counts: the cheapest mapped model costs less
    assert.ok(computeCostSatang(entry({ modelId: 'claude-3-haiku', inputTokens: 1_000_000 }), 33).costSatang < unknown.costSatang);
  });
});
