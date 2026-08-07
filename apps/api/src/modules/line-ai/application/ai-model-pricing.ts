/**
 * Pinned AI model prices and the satang cost formula (metering spec §6.4, §6.7, §7.4).
 * Money is computed once, at record time, from these prices and the configured THB rate —
 * never re-derived later, so a price or FX change only affects future rows.
 */

export type AiModelPrices = {
  /** USD per million tokens. */
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

export type PricedUsage = Pick<
  import('@watchdog-bms/contracts').AiUsageEntry,
  'modelId' | 'inputTokens' | 'outputTokens' | 'cacheReadInputTokens' | 'cacheWriteInputTokens'
>;

/**
 * Matched as a substring of `modelId` so provider prefixes and version suffixes resolve
 * without one row per id (`apac.anthropic.claude-3-5-sonnet-20241022-v2:0`,
 * `global.anthropic.claude-sonnet-4-6`). Keep the keys in step with APPROVED_AI_MODEL_IDS.
 */
export const AI_MODEL_PRICES: ReadonlyArray<readonly [string, AiModelPrices]> = [
  ['sonnet', { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }],
  ['haiku', { input: 0.25, output: 1.25, cacheRead: 0.03, cacheWrite: 0.3 }],
];

/**
 * Highest configured price per component. An unpriced model costs out here and warns —
 * never at 0. A silently free model is the deny-all-sentinel mistake applied to money:
 * price-map rot then over-counts (safe direction) instead of hiding spend.
 */
const MAX_PRICES: AiModelPrices = {
  input: Math.max(...AI_MODEL_PRICES.map(([, p]) => p.input)),
  output: Math.max(...AI_MODEL_PRICES.map(([, p]) => p.output)),
  cacheRead: Math.max(...AI_MODEL_PRICES.map(([, p]) => p.cacheRead)),
  cacheWrite: Math.max(...AI_MODEL_PRICES.map(([, p]) => p.cacheWrite)),
};

export function resolveAiModelPrices(modelId: string): { prices: AiModelPrices; known: boolean } {
  const id = (modelId ?? '').toLowerCase();
  const hit = AI_MODEL_PRICES.find(([match]) => id.includes(match));
  return hit ? { prices: hit[1], known: true } : { prices: MAX_PRICES, known: false };
}

/**
 * `unknownModel` tells the caller to warn (spec §6.7); the cost is still charged, at the
 * max configured price.
 *
 * Rounds HALF UP: every term is non-negative, and `Math.round` is half-up on non-negative
 * input. The ÷1e6 is applied last, after the ×100, so exact half-satang values stay exact
 * instead of drifting below the boundary on the way through a fractional intermediate.
 */
export function computeCostSatang(
  entry: PricedUsage,
  thbPerUsd: number,
): { costSatang: number; unknownModel: boolean } {
  const { prices, known } = resolveAiModelPrices(entry.modelId);
  const usdPerMTok =
    entry.inputTokens * prices.input +
    entry.outputTokens * prices.output +
    entry.cacheReadInputTokens * prices.cacheRead +
    entry.cacheWriteInputTokens * prices.cacheWrite;
  return {
    costSatang: Math.round((usdPerMTok * thbPerUsd * 100) / 1_000_000),
    unknownModel: !known,
  };
}
