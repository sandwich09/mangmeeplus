/**
 * Pinned AI model prices and the satang cost formula (metering spec §6.4, §6.7, §7.4).
 * Money is computed once, at record time, from these prices and the configured THB rate —
 * never re-derived later, so a price or FX change only affects future rows.
 */
import Decimal from 'decimal.js';
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
  ['claude-haiku-5-5', { input: 0.10, output: 0.50, cacheRead: 0.01, cacheWrite: 0.125 }],
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

/** V2 pins the actual rendered invocation and its tariff. No live-table fallback on settlement. */
export type AiTariffV2 = {
  version: string;
  provider: 'openai' | 'bedrock';
  modelId: string;
  region: string;
  usdPerMTok: AiModelPrices;
  thbPerUsd: number;
  externalUsdPerUnit?: number;
  /** Some approved search tariffs bill a fixed content block outside reported input usage. */
  searchContentInputTokensPerUnit?: number;
};
export function validAiTariffV2(value: AiTariffV2): boolean {
  return !!value && /^[A-Za-z0-9._:-]{1,128}$/.test(value.version)
    && (value.provider === 'openai' || value.provider === 'bedrock') && !!value.modelId && !!value.region
    && Number.isFinite(value.thbPerUsd) && value.thbPerUsd > 0
    && !!value.usdPerMTok && ['input', 'output', 'cacheRead', 'cacheWrite'].every((key) => {
      const rate = value.usdPerMTok[key as keyof AiModelPrices];
      return Number.isFinite(rate) && rate >= 0;
    }) && (value.externalUsdPerUnit === undefined || Number.isFinite(value.externalUsdPerUnit) && value.externalUsdPerUnit >= 0)
    && (value.searchContentInputTokensPerUnit === undefined || Number.isSafeInteger(value.searchContentInputTokensPerUnit) && value.searchContentInputTokensPerUnit >= 0);
}
export type AiRenderedPricingSnapshotV2 = AiStepBoundSnapshot & {
  contractVersion: 2;
  tariff: AiTariffV2;
  externalUnitBound: number;
};
export function priceRenderedAiInvocationV2(tariff: AiTariffV2, inputTokens: number, outputTokens: number, externalUnits = 0): {
  upperBoundSatang: number; snapshot: AiRenderedPricingSnapshotV2;
} | null {
  if (!validAiTariffV2(tariff) || !Number.isSafeInteger(inputTokens) || inputTokens <= 0
    || !Number.isSafeInteger(outputTokens) || outputTokens <= 0 || !Number.isSafeInteger(externalUnits) || externalUnits < 0
    || externalUnits > 2 || (externalUnits > 0 && tariff.externalUsdPerUnit === undefined)) return null;
  const inputUsdPerMTok = Math.max(tariff.usdPerMTok.input, tariff.usdPerMTok.cacheWrite);
  const bound = new Decimal(inputTokens).mul(inputUsdPerMTok).plus(new Decimal(outputTokens).mul(tariff.usdPerMTok.output))
    .plus(new Decimal(externalUnits).mul(tariff.searchContentInputTokensPerUnit ?? 0).mul(tariff.usdPerMTok.input))
    .div(1_000_000).plus(new Decimal(externalUnits).mul(tariff.externalUsdPerUnit ?? 0)).mul(tariff.thbPerUsd).mul(100).ceil();
  if (!bound.isFinite() || !Number.isSafeInteger(bound.toNumber())) return null;
  return { upperBoundSatang: bound.toNumber(), snapshot: {
    stepKind: 'provider-v2', modelId: tariff.modelId, usdPerMTok: { ...tariff.usdPerMTok }, inputUsdPerMTok,
    unknownModel: false, thbPerUsd: tariff.thbPerUsd, bounds: { maxInputTokens: inputTokens, maxOutputTokens: outputTokens, maxCalls: 1 },
    attempts: 1, contractVersion: 2, tariff: structuredClone(tariff), externalUnitBound: externalUnits,
  } };
}
export function computePinnedAiCostV2(snapshot: AiRenderedPricingSnapshotV2, entry: PricedUsage, externalUnits?: number | null): {
  costSatang: number; pricingSnapshot: AiPricingSnapshot & { tariffVersion: string; externalUnits: number; externalToolCostSatang: number };
} | null {
  const tariff = snapshot.tariff;
  if (!validAiTariffV2(tariff) || entry.modelId !== tariff.modelId
    || [entry.inputTokens, entry.outputTokens, entry.cacheReadInputTokens, entry.cacheWriteInputTokens].some((value) => !Number.isSafeInteger(value) || value < 0)) return null;
  if (snapshot.externalUnitBound > 0 && (externalUnits === undefined || externalUnits === null
    || !Number.isSafeInteger(externalUnits) || externalUnits < 0)) return null;
  if (externalUnits !== undefined && externalUnits !== null && (!Number.isSafeInteger(externalUnits) || externalUnits < 0)) return null;
  const units = externalUnits ?? 0;
  if (units > 0 && tariff.externalUsdPerUnit === undefined) return null;
  const rate = tariff.usdPerMTok;
  const raw = (count: number, price: number) => new Decimal(count).mul(price).mul(tariff.thbPerUsd).mul(100).div(1_000_000);
  const values = { input: raw(entry.inputTokens, rate.input), output: raw(entry.outputTokens, rate.output),
    cacheRead: raw(entry.cacheReadInputTokens, rate.cacheRead), cacheWrite: raw(entry.cacheWriteInputTokens, rate.cacheWrite) };
  const external = new Decimal(units).mul(tariff.externalUsdPerUnit ?? 0).mul(tariff.thbPerUsd).mul(100)
    .plus(new Decimal(units).mul(tariff.searchContentInputTokensPerUnit ?? 0).mul(rate.input).mul(tariff.thbPerUsd).mul(100).div(1_000_000));
  const cost = Object.values(values).reduce((sum, value) => sum.plus(value), external).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  if (!cost.isFinite() || !Number.isSafeInteger(cost.toNumber())) return null;
  const rounded = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber()])) as Record<keyof typeof values, number>;
  const externalToolCostSatang = external.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
  return { costSatang: cost.toNumber(), pricingSnapshot: {
    usdPerMTok: { ...rate }, thbPerUsd: tariff.thbPerUsd, unknownModel: false,
    componentSatang: { ...rounded, rounding: cost.toNumber() - Object.values(rounded).reduce((sum, value) => sum + value, 0) - externalToolCostSatang },
    tariffVersion: tariff.version, externalUnits: units, externalToolCostSatang,
  } };
}
