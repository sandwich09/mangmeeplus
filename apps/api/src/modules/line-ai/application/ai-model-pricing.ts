/**
 * Pinned AI model prices and the satang cost formula (metering spec §6.4, §6.7, §7.4).
 * Money is computed once, at record time, from these prices and the configured THB rate —
 * never re-derived later, so a price or FX change only affects future rows.
 */
import { aiBudgetStepBounds, type AiBudgetStepBounds } from '@watchdog-bms/contracts';

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

/** What a reservation pins: the exact inputs its `upperBoundSatang` was computed from (ADR 0013 §3). */
export type AiStepBoundSnapshot = {
  stepKind: string;
  modelId: string;
  /** The whole matched row, so a later price change leaves this hold reproducible. */
  usdPerMTok: AiModelPrices;
  /** The rate `maxInputTokens` was charged at: the HIGHER of input and cache-write. */
  inputUsdPerMTok: number;
  unknownModel: boolean;
  thbPerUsd: number;
  bounds: AiBudgetStepBounds;
  /** Provider attempts inside ONE call under an envelope; E1c pins the SDK to this. */
  attempts: 1;
};

/**
 * Prices ONE provider invocation's declared bound (remediation spec §12.3).
 *
 * Every token of `maxInputTokens` is charged at the HIGHER of the input and cache-write rates: a
 * cold cache writes the whole prompt at the more expensive rate, and assuming a cache hit would
 * under-reserve. Rounding is UP and happens PER INVOCATION — a chain of four calls holds four
 * ceilings, because four actuals each rounded half-up can otherwise exceed one summed ceiling.
 *
 * `null` means "this cannot be priced" and the caller must refuse with `AI_BUDGET_UNAVAILABLE`:
 * an unknown step kind (nobody declared a bound) or an unusable FX rate. An unknown MODEL is not
 * a refusal — `resolveAiModelPrices` already costs it out at the maximum configured price.
 */
export function priceAiStepUpperBound(
  stepKind: string,
  modelId: string,
  thbPerUsd: number,
): { upperBoundSatang: number; snapshot: AiStepBoundSnapshot } | null {
  const bounds = aiBudgetStepBounds(stepKind);
  if (!bounds || !Number.isFinite(thbPerUsd) || thbPerUsd <= 0) return null;
  const { prices, known } = resolveAiModelPrices(modelId);
  const inputUsdPerMTok = Math.max(prices.input, prices.cacheWrite);
  const usdPerMTok = bounds.maxInputTokens * inputUsdPerMTok + bounds.maxOutputTokens * prices.output;
  return {
    upperBoundSatang: Math.ceil((usdPerMTok * thbPerUsd * 100) / 1_000_000),
    snapshot: {
      stepKind, modelId, usdPerMTok: prices, inputUsdPerMTok,
      unknownModel: !known, thbPerUsd, bounds, attempts: 1,
    },
  };
}

/** The priced evidence stamped on a new `AiUsageEvent` (remediation spec §11.2). */
export type AiPricingSnapshot = {
  /** USD per million tokens actually charged — the max table when the model id matched nothing. */
  usdPerMTok: AiModelPrices;
  thbPerUsd: number;
  /** True when `usdPerMTok` is the max-price fallback rather than a matched model row. */
  unknownModel: boolean;
  /** Per-component satang; `rounding` closes the gap so the five sum EXACTLY to `costSatang`. */
  componentSatang: { input: number; output: number; cacheRead: number; cacheWrite: number; rounding: number };
};

/**
 * Splits an already-computed `costSatang` into its components. The authoritative number stays the
 * single half-up rounding in `computeCostSatang`: each component is rounded the same way and the
 * residue lands in `rounding`, so the snapshot can never contradict the money on the row.
 */
export function buildPricingSnapshot(
  entry: PricedUsage,
  thbPerUsd: number,
  costSatang: number,
): AiPricingSnapshot {
  const { prices, known } = resolveAiModelPrices(entry.modelId);
  const satang = (tokens: number, usdPerMTok: number) =>
    Math.round((tokens * usdPerMTok * thbPerUsd * 100) / 1_000_000);
  const input = satang(entry.inputTokens, prices.input);
  const output = satang(entry.outputTokens, prices.output);
  const cacheRead = satang(entry.cacheReadInputTokens, prices.cacheRead);
  const cacheWrite = satang(entry.cacheWriteInputTokens, prices.cacheWrite);
  return {
    usdPerMTok: prices,
    thbPerUsd,
    unknownModel: !known,
    componentSatang: {
      input,
      output,
      cacheRead,
      cacheWrite,
      rounding: costSatang - (input + output + cacheRead + cacheWrite),
    },
  };
}
