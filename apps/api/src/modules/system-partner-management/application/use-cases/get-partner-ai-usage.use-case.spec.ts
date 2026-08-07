import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GetPartnerAiUsageUseCase } from './get-partner-ai-usage.use-case';
import { bangkokMonthKey, previousBangkokMonthKey } from '../../../line-ai/application/company-ai-usage-meter';

const CURRENT = bangkokMonthKey();
const PREVIOUS = previousBangkokMonthKey();

function makeConfig() {
  return { aiMonthlyBudgetSatang: 5_000_000, aiMonthlyBudgetSatangCeiling: 50_000_000 } as any;
}

function monthRow(monthKey: string, costSatang: number) {
  return {
    monthKey,
    costSatang,
    callCount: 7,
    inputTokens: 100,
    outputTokens: 200,
    cacheReadInputTokens: 300,
    cacheWriteInputTokens: 400,
  };
}

function makePrisma(opts: {
  months?: Array<ReturnType<typeof monthRow>>;
  overrideSatang?: number | null;
  tags?: Array<{ usageTag: string; _sum: { costSatang: number | null }; _count: { _all: number } }>;
} = {}) {
  const calls: { monthWhere?: any; groupBy?: any } = {};
  return {
    calls,
    client: {
      companyAiMonthlyUsage: {
        findMany: async (args: any) => { calls.monthWhere = args.where; return opts.months ?? []; },
      },
      companyAiConfiguration: {
        findUnique: async () => (opts.overrideSatang === undefined ? null : { monthlyBudgetSatang: opts.overrideSatang }),
      },
      aiUsageEvent: {
        groupBy: async (args: any) => { calls.groupBy = args; return opts.tags ?? []; },
      },
    },
  } as any;
}

describe('GetPartnerAiUsageUseCase', () => {
  it('maps the current and previous month aggregates', async () => {
    const prisma = makePrisma({ months: [monthRow(PREVIOUS, 111), monthRow(CURRENT, 222)] });
    const result = await new GetPartnerAiUsageUseCase(prisma, makeConfig()).execute('co-1');

    assert.equal(result.current?.monthKey, CURRENT);
    assert.equal(result.current?.costSatang, 222);
    assert.equal(result.current?.callCount, 7);
    assert.equal(result.current?.cacheWriteInputTokens, 400);
    assert.equal(result.previous?.costSatang, 111);
    assert.deepEqual(prisma.calls.monthWhere, { companyId: 'co-1', monthKey: { in: [CURRENT, PREVIOUS] } });
  });

  it('returns null for a month with no aggregate row', async () => {
    const prisma = makePrisma({ months: [monthRow(PREVIOUS, 111)] });
    const result = await new GetPartnerAiUsageUseCase(prisma, makeConfig()).execute('co-1');
    assert.equal(result.current, null);
    assert.equal(result.previous?.monthKey, PREVIOUS);
  });

  it('reports the platform default as effective when there is no override', async () => {
    const prisma = makePrisma();
    const result = await new GetPartnerAiUsageUseCase(prisma, makeConfig()).execute('co-1');
    assert.deepEqual(result.budget, {
      effectiveSatang: 5_000_000,
      overrideSatang: null,
      defaultSatang: 5_000_000,
      ceilingSatang: 50_000_000,
    });
  });

  it('reports the override as effective when one is set, keeping the default visible', async () => {
    const prisma = makePrisma({ overrideSatang: 900_000 });
    const result = await new GetPartnerAiUsageUseCase(prisma, makeConfig()).execute('co-1');
    assert.deepEqual(result.budget, {
      effectiveSatang: 900_000,
      overrideSatang: 900_000,
      defaultSatang: 5_000_000,
      ceilingSatang: 50_000_000,
    });
  });

  it('maps top tags and asks the DB for the current month only, cost-desc, capped at 10', async () => {
    const prisma = makePrisma({
      tags: [
        { usageTag: 'line-turn', _sum: { costSatang: 500 }, _count: { _all: 4 } },
        { usageTag: 'receipt-ocr', _sum: { costSatang: null }, _count: { _all: 1 } },
      ],
    });
    const result = await new GetPartnerAiUsageUseCase(prisma, makeConfig()).execute('co-1');

    assert.deepEqual(result.topTags, [
      { tag: 'line-turn', costSatang: 500, calls: 4 },
      { tag: 'receipt-ocr', costSatang: 0, calls: 1 },
    ]);
    assert.deepEqual(prisma.calls.groupBy.where, { companyId: 'co-1', monthKey: CURRENT });
    assert.deepEqual(prisma.calls.groupBy.orderBy, { _sum: { costSatang: 'desc' } });
    assert.equal(prisma.calls.groupBy.take, 10);
  });

  it('previousBangkokMonthKey rolls the year back at January', () => {
    // 2026-01-01 07:00 Bangkok = 2026-01-01T00:00Z
    assert.equal(previousBangkokMonthKey(new Date('2026-01-01T00:00:00.000Z')), '2025-12');
    assert.equal(previousBangkokMonthKey(new Date('2026-03-15T00:00:00.000Z')), '2026-02');
    // Bangkok is +7: 23:30 UTC on the last day of July is already August there.
    assert.equal(previousBangkokMonthKey(new Date('2026-07-31T23:30:00.000Z')), '2026-07');
  });
});
