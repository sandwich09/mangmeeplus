import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AI_BUDGET_STEP_BOUNDS, type AiBudgetStepKind } from '@watchdog-bms/contracts';
import { AI_MODEL_PRICES, computeCostSatang, priceAiStepUpperBound, resolveAiModelPrices } from './ai-model-pricing';

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

// ── Declared step bounds (remediation spec §12.3, ADR 0013 §3) ───────────────

const SONNET = 'apac.anthropic.claude-3-5-sonnet-20241022-v2:0';
const HAIKU = 'apac.anthropic.claude-3-haiku-20240307-v1:0';

describe('priceAiStepUpperBound', () => {
  it('prices input at the HIGHER of the input and cache-write rates — a cold cache is the worst case', () => {
    const priced = priceAiStepUpperBound('crm-intake', SONNET, 33)!;
    const prices = resolveAiModelPrices(SONNET).prices;

    assert.ok(prices.cacheWrite > prices.input, 'sonnet cache-write must be the dearer of the two');
    assert.equal(priced.snapshot.inputUsdPerMTok, prices.cacheWrite);
    // Assuming a cache HIT would under-reserve, which is the one direction money may not go.
    assert.ok(priced.upperBoundSatang > priceAiStepUpperBound('crm-intake', HAIKU, 33)!.upperBoundSatang);
  });

  it('rounds UP per invocation, so N ceilings can never be crossed by N actuals', () => {
    // 1 input token at 3.75 USD/MTok, FX 33 => 0.0000124 satang. A half-up round is 0; a hold of 0
    // would let an actual of 1 satang breach the bound immediately.
    const tiny = priceAiStepUpperBound('crm-intake', SONNET, 33)!;
    const exact = (AI_BUDGET_STEP_BOUNDS['crm-intake'].maxInputTokens * 3.75
      + AI_BUDGET_STEP_BOUNDS['crm-intake'].maxOutputTokens * 15) * 33 * 100 / 1_000_000;

    assert.equal(tiny.upperBoundSatang, Math.ceil(exact));
    assert.ok(tiny.upperBoundSatang >= exact, 'a hold may never be below the priced bound');
  });

  it('refuses (null) what it cannot price: an undeclared step kind or an unusable FX rate', () => {
    assert.equal(priceAiStepUpperBound('not-a-declared-step', SONNET, 33), null);
    assert.equal(priceAiStepUpperBound('crm-intake', SONNET, Number.NaN), null);
    assert.equal(priceAiStepUpperBound('crm-intake', SONNET, 0), null);
  });

  it('holds an unknown model at the maximum configured price and says so — never free, never null', () => {
    const unknown = priceAiStepUpperBound('line-turn', 'some.unlisted-model-v9', 33)!;

    assert.equal(unknown.snapshot.unknownModel, true);
    assert.equal(unknown.upperBoundSatang, priceAiStepUpperBound('line-turn', SONNET, 33)!.upperBoundSatang);
    assert.ok(unknown.upperBoundSatang > priceAiStepUpperBound('line-turn', HAIKU, 33)!.upperBoundSatang);
  });

  it('pins the model, rates, FX, bounds and attempts on the snapshot the hold stores', () => {
    const priced = priceAiStepUpperBound('receipt-ocr', SONNET, 33)!;

    assert.equal(priced.snapshot.stepKind, 'receipt-ocr');
    assert.equal(priced.snapshot.modelId, SONNET);
    assert.equal(priced.snapshot.thbPerUsd, 33);
    assert.equal(priced.snapshot.attempts, 1, 'SDK attempts are pinned to one under an envelope');
    assert.deepEqual(priced.snapshot.bounds, AI_BUDGET_STEP_BOUNDS['receipt-ocr']);
  });

  /**
   * R-01: the feasibility table the spec demands, asserted so that changing a declared bound is a
   * VISIBLE diff in this file rather than a silent change to what a supported cap can start.
   * The minimum bucket cap that can start a step IS its bound (spend and holds are 0 at that point).
   * Source of every `maxOutputTokens`: docs/research/ai-budget-step-bounds-2026-09-17.md.
   */
  it('matches the published feasibility table at FX 33 for Sonnet and Haiku (R-01)', () => {
    const expected: Record<AiBudgetStepKind, { sonnet: number; haiku: number }> = {
      'line-intake-text': { sonnet: 322, haiku: 26 },
      'line-intake-image': { sonnet: 768, haiku: 63 },
      'line-turn': { sonnet: 546, haiku: 44 },
      'receipt-ocr': { sonnet: 777, haiku: 64 },
      'bank-statement': { sonnet: 575, haiku: 47 },
      'crm-summary': { sonnet: 327, haiku: 27 },
      'crm-reply-draft': { sonnet: 273, haiku: 22 },
      'crm-intake': { sonnet: 258, haiku: 21 },
      'crm-customer-profile-extract': { sonnet: 265, haiku: 22 },
      'crm-booking-extract': { sonnet: 263, haiku: 22 },
      'crm-insights': { sonnet: 278, haiku: 23 },
      'crm-broadcast': { sonnet: 307, haiku: 25 },
      'crm-trust-score': { sonnet: 258, haiku: 21 },
      'draft-generate': { sonnet: 293, haiku: 24 },
    };

    // Every declared step kind is in the table, and nothing else is: a new seam cannot be added
    // without its feasibility number being reviewed here.
    assert.deepEqual(Object.keys(expected).sort(), Object.keys(AI_BUDGET_STEP_BOUNDS).sort());
    for (const [stepKind, want] of Object.entries(expected)) {
      assert.equal(priceAiStepUpperBound(stepKind, SONNET, 33)!.upperBoundSatang, want.sonnet, `sonnet ${stepKind}`);
      assert.equal(priceAiStepUpperBound(stepKind, HAIKU, 33)!.upperBoundSatang, want.haiku, `haiku ${stepKind}`);
    }
  });

  it('declares a finite call ceiling for every step kind, so no chain is unbounded (E-05)', () => {
    for (const [stepKind, bounds] of Object.entries(AI_BUDGET_STEP_BOUNDS)) {
      assert.ok(Number.isSafeInteger(bounds.maxCalls) && bounds.maxCalls >= 1, `${stepKind} maxCalls`);
      assert.ok(bounds.maxInputTokens > 0 && bounds.maxOutputTokens > 0, `${stepKind} token bounds`);
    }
  });
});
