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
  it('R18 prices Haiku 5.5 warm and cold calls with one half-up rounding', () => {
    for (const modelId of ['global.anthropic.claude-haiku-5-5', 'claude-haiku-5-5']) {
      assert.deepEqual(resolveAiModelPrices(modelId), {
        known: true, prices: { input: 0.10, output: 0.50, cacheRead: 0.01, cacheWrite: 0.125 },
      });
      assert.equal(computeCostSatang(entry({ modelId, inputTokens: 300, outputTokens: 100, cacheReadInputTokens: 2500 }), 33).costSatang, 0);
      assert.equal(computeCostSatang(entry({ modelId, inputTokens: 300, outputTokens: 100, cacheWriteInputTokens: 2500 }), 33).costSatang, 1);
      assert.equal(computeCostSatang(entry({ modelId, inputTokens: 50_000 }), 1).costSatang, 1);
    }
    assert.deepEqual(resolveAiModelPrices('apac.anthropic.claude-3-haiku-20240307-v1:0').prices,
      { input: 0.25, output: 1.25, cacheRead: 0.03, cacheWrite: 0.3 });
  });

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
      // Same declared bounds as `receipt-ocr` (30,000 / 8,192), so the same price per call; the
      // capture job differs only in metering one call at a time (appendix §4.6).
      'receipt-capture-read': { sonnet: 777, haiku: 64 },
      'receipt-capture-extract': { sonnet: 777, haiku: 64 },
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

describe('v2 rendered invocation pricing and pinned settlement', () => {
  it('reserves actual rendered input, including cold-cache and hosted costs, instead of the profile ceiling', async () => {
    const { priceRenderedAiInvocationV2 } = await import('./ai-model-pricing');
    const tariff = { version: 'fixture:1', provider: 'openai' as const, modelId: 'fixture-model', region: 'fixture', thbPerUsd: 33,
      usdPerMTok: { input: 1, output: 4, cacheRead: 0.1, cacheWrite: 2 }, externalUsdPerUnit: 0.01 };
    const small = priceRenderedAiInvocationV2(tariff, 1024, 512, 2)!;
    const large = priceRenderedAiInvocationV2(tariff, 160000, 512, 2)!;
    assert.ok(small.upperBoundSatang < large.upperBoundSatang);
    assert.equal(small.snapshot.bounds.maxInputTokens, 1024);
    assert.equal(small.upperBoundSatang, Math.ceil((1024 * 2 / 1e6 + 512 * 4 / 1e6 + 0.02) * 33 * 100));
    assert.equal(priceRenderedAiInvocationV2({ ...tariff, externalUsdPerUnit: undefined }, 1024, 512, 2), null);
  });
  it('settles against the pinned tariff despite an unrelated live model price and retains unknown hosted usage', async () => {
    const { priceRenderedAiInvocationV2, computePinnedAiCostV2 } = await import('./ai-model-pricing');
    const tariff = { version: 'fixture:2', provider: 'openai' as const, modelId: 'unlisted-model', region: 'fixture', thbPerUsd: 33,
      usdPerMTok: { input: 1, output: 4, cacheRead: 0.1, cacheWrite: 2 }, externalUsdPerUnit: 0.01 };
    const { snapshot } = priceRenderedAiInvocationV2(tariff, 4096, 1024, 2)!;
    tariff.usdPerMTok.input = 999;
    const entry = { modelId: 'unlisted-model', inputTokens: 1000, outputTokens: 100, cacheReadInputTokens: 0, cacheWriteInputTokens: 0 };
    assert.equal(computePinnedAiCostV2(snapshot, entry), null);
    assert.equal(computePinnedAiCostV2(snapshot, entry, null), null);
    assert.equal(computePinnedAiCostV2(snapshot, { ...entry, modelId: 'different-model' }, 1), null);
    const billed = computePinnedAiCostV2(snapshot, entry, 1)!;
    assert.equal(billed.costSatang, 38);
    assert.equal(billed.pricingSnapshot.usdPerMTok.input, 1);
    assert.equal(Object.values(billed.pricingSnapshot.componentSatang).reduce((sum, n) => sum + n, 0)
      + billed.pricingSnapshot.externalToolCostSatang, billed.costSatang);
  });
});

// Registered package-test home for the owner-approved reservation/settlement regression checks.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { priceRenderedAiInvocationV2 } from './ai-model-pricing';
import { splitPrisma } from './company-ai-budget-prisma.fixture';
import { consumeAiCreditHold } from './ai-credit-ledger';
import { decideAiBudgetStep, reserveAiBudgetStep, settleAiBudgetStep } from './company-ai-budget-reservation';
const decideCredit = (over: Partial<Parameters<typeof decideAiBudgetStep>[0]> = {}) => decideAiBudgetStep({
  bucket: 'CHAT', boundSatang: 100, totalSatang: 10_000, capSatang: 3_000,
  spent: { total: 0, bucket: 0 }, reserved: { total: 0, bucket: 0 }, override: false, ...over,
});

describe('owner 2026-10-19: successful overruns are alerted without customer lockout', () => {
  for (const remaining of [300, 1200]) it(`settles actual, charges at most ${remaining} available satang and preserves competing holds`, async () => {
    const modelId = 'apac.anthropic.claude-3-haiku-20240307-v1:0';
    const price = priceRenderedAiInvocationV2({ version: 'test:1', provider: 'bedrock', modelId, region: 'ap-southeast-1', thbPerUsd: 33,
      usdPerMTok: { input: 0.25, output: 1.25, cacheRead: 0.03, cacheWrite: 0.3 } }, 4096, 2048)!;
    const ownHold = price.upperBoundSatang, competing = 100;
    const lot = { id: 'cycle-lot', sourceKind: 'INCLUDED_CYCLE', units: remaining + competing,
      availableAt: new Date('2026-10-01'), expiresAt: new Date('2026-11-01') };
    const debits: any[] = [], locks: string[] = [];
    const fixture = splitPrisma({ total: 10000, chat: 5000, ocr: 5000 }, {
      $executeRaw: async (_sql: unknown, key: string) => { locks.push(key); return 0; },
      aiCreditGrant: { findMany: async ({ where }: any) => { assert.equal(where.companyId, 'co'); return [lot]; } },
      aiCreditEntry: {
        findMany: async () => [{ grantId: lot.id, units: -ownHold, grant: lot }],
        groupBy: async ({ where }: any) => where.kind === 'RESERVE'
          ? [{ grantId: lot.id, _sum: { units: -ownHold - competing } }] : [],
        createMany: async ({ data }: any) => { debits.push(...data); return { count: data.length }; },
      },
    });
    fixture.prisma.client.aiBudgetReservation.findMany = async () => [{ id: 'hold' }, { id: 'competing' }];
    // If admission still asks for breach count this fake forces the old lockout, making the test fail.
    fixture.prisma.client.aiBudgetReservation.count = async () => 1;
    const key = 'co#overrun#provider-v2#0';
    fixture.reservations.set('hold', { id: 'hold', companyId: 'co', monthKey: '2026-10', bucket: 'CHAT', stepKind: 'provider-v2',
      invocationKey: key, status: 'DISPATCHED', upperBoundSatang: ownHold,
      pricingSnapshot: { ...price.snapshot, aiCredit: { cycleKey: 'cycle', asOf: '2026-10-19T00:00:00Z' } } });
    const input = { invocationKey: key, meta: { sourceRoute: 'line-ai-v2' },
      entry: { tag: 'line.loop', modelId, ok: true, inputTokens: 1_000_000, outputTokens: 0,
        cacheReadInputTokens: 0, cacheWriteInputTokens: 0, durationMs: 1, usageBasis: 'PROVIDER_REPORTED' as const } };
    assert.equal(await settleAiBudgetStep(fixture.prisma, input), 'settled');
    assert.deepEqual(locks.slice(0, 2), ['partner-ocr-config:co', 'ai-budget:co:2026-10']);
    const hold = fixture.reservations.get('hold'), actual = hold.settledCostSatang;
    const charged = -debits.reduce((sum, row) => sum + row.units, 0);
    assert.ok(actual > ownHold);
    assert.equal(charged, Math.min(actual, remaining));
    assert.ok(charged <= actual && charged <= remaining);
    assert.equal(hold.status, 'SETTLED');
    assert.equal(hold.breach, true, 'unacknowledged operator alert survives');
    assert.equal(hold.evidenceJson.customerChargedSatang, charged);
    assert.equal(hold.evidenceJson.companyAbsorbedSatang, actual - charged);
    assert.equal(fixture.events.get(key).costSatang, actual, 'complete provider cost evidence');
    assert.equal(await settleAiBudgetStep(fixture.prisma, input), 'duplicate');
    assert.equal(debits.length, 1, 'settle replay cannot debit twice');
    const next = await reserveAiBudgetStep(fixture.prisma, { aiMonthlyBudgetSatang: 10000 } as never, {
      companyId: 'co', monthKey: '2026-10', bucket: 'CHAT', stepKind: 'crm-intake', attemptKey: 'after-overrun', ordinal: 0,
      sourceRoute: 'crm-intake', modelId, thbPerUsd: 33, thbPerUsdSource: 'test' });
    assert.equal(next.ok, true, 'a breach never creates an acknowledgement lockout');
  });

  it('can fund the overrun from another eligible lot while preserving expiry and spend order', async () => {
    const at = new Date('2026-10-19');
    const cycle = { id: 'cycle', sourceKind: 'INCLUDED_CYCLE', units: 100, availableAt: at, expiresAt: new Date('2026-11-01') };
    const added = { id: 'added', sourceKind: 'ADD_ON_PAID', units: 70, availableAt: at, expiresAt: new Date('2027-01-01') };
    const writes: any[] = [];
    const tx = {
      aiCreditGrant: { findMany: async () => [cycle, added] },
      aiBudgetReservation: { findMany: async () => [{ id: 'r' }] },
      aiCreditEntry: { findMany: async () => [{ grantId: 'cycle', units: -50, grant: cycle }],
        groupBy: async ({ where }: any) => where.kind === 'RESERVE' ? [{ grantId: 'cycle', _sum: { units: -50 } }] : [],
        createMany: async ({ data }: any) => { writes.push(...data); return { count: data.length }; } },
    };
    assert.equal(await consumeAiCreditHold(tx, { companyId: 'co', reservationId: 'r', costSatang: 150, overrun: { cycleKey: 'c', asOf: at } }), 150);
    assert.deepEqual(writes.map(row => [row.grantId, row.units]), [['cycle', -100], ['added', -50]]);
  });
});

it('credit X1: real-builder hold table uses pinned pricing and a typical three-call claim admits with ten baht left', () => {
  const report = JSON.parse(readFileSync(join(__dirname, '../../../../../..', 'docs/evidence/line-ai-credit-levers-20261019-measurements.json'), 'utf8'));
  for (const row of report.rows) {
    const publicLookup = row.model === 'gpt-4.1-mini';
    const tariff = { version: 'table:1', provider: publicLookup ? 'openai' as const : 'bedrock' as const, modelId: row.model,
      region: publicLookup ? 'US' : 'ap-southeast-1', thbPerUsd: 33,
      usdPerMTok: publicLookup ? { input: .4, output: 1.6, cacheRead: .1, cacheWrite: .4 } : { input: 3, output: 15, cacheRead: .3, cacheWrite: 3.75 },
      ...(publicLookup ? { externalUsdPerUnit: .01, searchContentInputTokensPerUnit: 8000 } : {}) };
    for (const side of ['Before', 'After']) {
      assert.equal(priceRenderedAiInvocationV2(tariff, row[`bound${side}`], row.output, publicLookup ? 2 : 0)?.upperBoundSatang,
        Math.round(row[`hold${side}Thb`] * 100), `${row.name}/${side}`);
    }
  }
  const intake = report.rows.find((r: any) => r.name === 'intake text 4 turns pending task');
  assert.equal(intake.holdBeforeThb, 14.45);
  assert.equal(intake.holdAfterThb, 7.86);
  let spent = 0;
  for (const [name, actual] of [[intake.name, 92], ['claim control', 50], ['line.compose', 50]] as const) {
    const row = report.rows.find((r: any) => r.name === name);
    assert.deepEqual(decideCredit({ totalSatang: 1000, capSatang: 1000, boundSatang: Math.round(row.holdAfterThb * 100),
      spent: { total: spent, bucket: spent } }), { ok: true }, name);
    spent += actual;
  }
  assert.ok(spent < 1000, 'representative warm usage, not a guarantee for arbitrary cold or long turns');
});
