import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { Logger } from '@nestjs/common';
import type { AiUsageEntry } from '@watchdog-bms/contracts';
import { __resetFxCache } from './ai-fx-rate';
import {
  __resetCompanyAiBudgetCache,
  assertCompanyAiBudget,
  bangkokMonthKey,
  recordCompanyAiUsage,
  resolvePlatformAiBudget,
} from './company-ai-usage-meter';

const config = { aiThbPerUsd: 33 } as any;

const usage = (over: Partial<AiUsageEntry> = {}): AiUsageEntry => ({
  tag: 'line_turn',
  modelId: 'apac.anthropic.claude-3-5-sonnet-20241022-v2:0',
  ok: true,
  inputTokens: 10_000,
  outputTokens: 2_000,
  cacheReadInputTokens: 50_000,
  cacheWriteInputTokens: 8_000,
  durationMs: 1234,
  ...over,
});

/** Fake prisma that records what ran inside each `$transaction` callback and keeps the
 *  aggregate's running totals, so increments across calls are observable. */
function fakePrisma(monthlyBudgetSatang?: number | null) {
  const transactions: Array<Array<{ op: string; args: any }>> = [];
  const aggregate: Record<string, number> = {};
  const client = {
    // Read by the post-transaction threshold check; `undefined` means "no configuration row".
    companyAiConfiguration: {
      findUnique: async () => (monthlyBudgetSatang === undefined ? null : { monthlyBudgetSatang }),
    },
    $transaction: async (fn: (tx: any) => Promise<any>) => {
      const ops: Array<{ op: string; args: any }> = [];
      transactions.push(ops);
      const tx = {
        aiUsageEvent: {
          createMany: async (args: any) => {
            ops.push({ op: 'createMany', args });
            return { count: args.data.length };
          },
        },
        companyAiMonthlyUsage: {
          upsert: async (args: any) => {
            ops.push({ op: 'upsert', args });
            const key = `${args.where.companyId_monthKey.companyId}:${args.where.companyId_monthKey.monthKey}`;
            aggregate[key] = (aggregate[key] ?? 0) + (args.create.costSatang as number);
            return { costSatang: aggregate[key] };
          },
        },
      };
      return fn(tx);
    },
  };
  return { prisma: { client } as any, transactions, aggregate };
}

let warnings: any[];
const originalWarn = Logger.prototype.warn;
const originalFetch = globalThis.fetch;

beforeEach(() => {
  warnings = [];
  (Logger.prototype as any).warn = (payload: any) => { warnings.push(payload); };
  // The budget cache is module-level and keyed only by companyId, so it would otherwise leak
  // one test's override into the next.
  __resetCompanyAiBudgetCache();
  __resetFxCache();
  // These fakes carry no `aiFxRate` delegate, so FX resolution degrades to the env rate without
  // an outbound call — this proves it rather than trusting it.
  (globalThis as any).fetch = async () => assert.fail('the meter must not reach the network');
});
afterEach(() => {
  (Logger.prototype as any).warn = originalWarn;
  globalThis.fetch = originalFetch;
});

describe('bangkokMonthKey', () => {
  it('rolls to the next month at 17:00 UTC, when Bangkok hits midnight', () => {
    assert.equal(bangkokMonthKey(new Date('2026-07-31T23:30:00Z')), '2026-08');
    assert.equal(bangkokMonthKey(new Date('2026-07-31T16:59:59Z')), '2026-07');
    assert.equal(bangkokMonthKey(new Date('2026-07-31T17:00:00Z')), '2026-08');
  });

  it('zero-pads single-digit months', () => {
    assert.equal(bangkokMonthKey(new Date('2026-01-15T00:00:00Z')), '2026-01');
  });
});

describe('recordCompanyAiUsage', () => {
  it('writes the events and the aggregate increment in ONE transaction', async () => {
    const { prisma, transactions } = fakePrisma();

    await recordCompanyAiUsage(prisma, config, { companyId: 'co-1', sourceRoute: 'line-turn', requestId: 'req-1' }, [
      usage(),
      usage({ tag: 'critic' }),
    ]);

    assert.equal(transactions.length, 1, 'exactly one transaction');
    assert.deepEqual(transactions[0]!.map((o) => o.op), ['createMany', 'upsert']);

    const created = transactions[0]![0]!.args.data;
    assert.equal(created.length, 2, 'one AiUsageEvent row per reported model call');
    assert.equal(created[0].companyId, 'co-1');
    assert.equal(created[0].sourceRoute, 'line-turn');
    assert.equal(created[0].usageTag, 'line_turn');
    assert.equal(created[0].requestId, 'req-1');
    assert.equal(created[0].costSatang, 347);
    assert.equal(created[0].monthKey, bangkokMonthKey());
  });

  it('upserts on the unique row with scalar increments only (native ON CONFLICT, no nested writes)', async () => {
    const { prisma, transactions } = fakePrisma();

    await recordCompanyAiUsage(prisma, config, { companyId: 'co-1', sourceRoute: 'crm-summary' }, [usage()]);

    const upsert = transactions[0]![1]!.args;
    assert.deepEqual(Object.keys(upsert.where), ['companyId_monthKey']);
    assert.deepEqual(upsert.update.costSatang, { increment: 347 });
    assert.deepEqual(upsert.update.callCount, { increment: 1 });
    assert.deepEqual(upsert.update.inputTokens, { increment: 10_000 });
    // create/update carry the FK as a scalar; a nested `company: { connect }` would stop
    // Prisma compiling this to a single INSERT … ON CONFLICT DO UPDATE.
    assert.equal(upsert.create.companyId, 'co-1');
    assert.equal('company' in upsert.create, false);
    assert.equal('company' in upsert.update, false);
  });

  it('accumulates increments across calls and reports pre/post spend', async () => {
    const { prisma } = fakePrisma();
    const meta = { companyId: 'co-1', sourceRoute: 'line-turn' };

    const first = await recordCompanyAiUsage(prisma, config, meta, [usage()]);
    const second = await recordCompanyAiUsage(prisma, config, meta, [usage(), usage()]);

    assert.deepEqual(first, { pre: 0, post: 347 });
    assert.deepEqual(second, { pre: 347, post: 347 + 694 });
  });

  it('warns ai.usage.absent and writes nothing when the response carried no usage', async () => {
    const { prisma, transactions } = fakePrisma();

    const empty = await recordCompanyAiUsage(prisma, config, { companyId: 'co-1', sourceRoute: 'line-turn', requestId: 'req-9' }, []);
    const missing = await recordCompanyAiUsage(prisma, config, { companyId: 'co-1', sourceRoute: 'line-turn', requestId: 'req-9' }, undefined);

    assert.equal(empty, undefined);
    assert.equal(missing, undefined);
    assert.equal(transactions.length, 0, 'nothing is written');
    assert.equal(warnings.length, 2, 'one warn per absent response, not one per entry');
    assert.deepEqual(warnings[0], {
      msg: 'ai.usage.absent',
      sourceRoute: 'line-turn',
      requestId: 'req-9',
      companyId: 'co-1',
    });
  });

  it('still records an unknown model, at the max price, with a warn', async () => {
    const { prisma, transactions } = fakePrisma();

    await recordCompanyAiUsage(prisma, config, { companyId: 'co-1', sourceRoute: 'draft-generate' }, [
      usage({ modelId: 'some.unlisted-model-v9' }),
    ]);

    assert.ok(transactions[0]![0]!.args.data[0].costSatang > 0);
    assert.equal(warnings.filter((w) => w?.msg === 'ai.usage.unknown_model_price').length, 1);
  });
});

// ── Budget half (spec §7.5 assert, §6.6 check-before-act, §6.7 fail closed) ──────────

const budgetConfig = { aiThbPerUsd: 33, aiMonthlyBudgetSatang: 200_000 } as any;

/**
 * The two delegates the budget check reads, with counters so "cached" vs "live" is observable.
 * `monthlyBudgetSatang: undefined` = no configuration row at all; `null` = a row that inherits.
 */
function budgetPrisma(options: { monthlyBudgetSatang?: number | null; spendSatang?: number } = {}) {
  const reads = { budget: 0, spend: 0 };
  let spendSatang = options.spendSatang;
  const client = {
    companyAiConfiguration: {
      findUnique: async () => {
        reads.budget += 1;
        return options.monthlyBudgetSatang === undefined ? null : { monthlyBudgetSatang: options.monthlyBudgetSatang };
      },
    },
    companyAiMonthlyUsage: {
      findUnique: async () => {
        reads.spend += 1;
        return spendSatang === undefined ? null : { costSatang: spendSatang };
      },
    },
  };
  return { prisma: { client } as any, reads, setSpend: (value: number) => { spendSatang = value; } };
}

describe('assertCompanyAiBudget resolution', () => {
  it('falls back to the platform default when the company has no configuration row', async () => {
    const { prisma } = budgetPrisma({ spendSatang: 199_999 });
    assert.deepEqual(await assertCompanyAiBudget(prisma, budgetConfig, 'co-default'), { allowed: true });
  });

  it('prefers a non-null row override over the platform default', async () => {
    const { prisma } = budgetPrisma({ monthlyBudgetSatang: 50_000, spendSatang: 60_000 });

    assert.deepEqual(await assertCompanyAiBudget(prisma, budgetConfig, 'co-override'), {
      allowed: false,
      reason: 'exceeded',
      spendSatang: 60_000,
      budgetSatang: 50_000,
      override: true,
    });
  });

  it('treats a null override exactly like an absent row: inherit the platform default', async () => {
    const { prisma } = budgetPrisma({ monthlyBudgetSatang: null, spendSatang: 200_000 });

    assert.deepEqual(await assertCompanyAiBudget(prisma, budgetConfig, 'co-null-override'), {
      allowed: false,
      reason: 'exceeded',
      spendSatang: 200_000,
      budgetSatang: 200_000,
      override: false,
    });
  });

  it('caches the budget row for 60s and re-reads once the TTL is past', async () => {
    const { prisma, reads } = budgetPrisma({ monthlyBudgetSatang: 90_000, spendSatang: 0 });
    mock.timers.enable({ apis: ['Date'] });
    try {
      await assertCompanyAiBudget(prisma, budgetConfig, 'co-ttl');
      await assertCompanyAiBudget(prisma, budgetConfig, 'co-ttl');
      assert.equal(reads.budget, 1, 'the config half is cached — no DB round trip per AI call');

      mock.timers.tick(60_001);
      await assertCompanyAiBudget(prisma, budgetConfig, 'co-ttl');
      assert.equal(reads.budget, 2, 'an operator budget change must land within a minute');
    } finally {
      mock.timers.reset();
    }
  });

  it('reads spend live on every call, so a fresh increment is seen immediately', async () => {
    const { prisma, reads, setSpend } = budgetPrisma({ monthlyBudgetSatang: 10_000, spendSatang: 9_999 });

    assert.deepEqual(await assertCompanyAiBudget(prisma, budgetConfig, 'co-live'), { allowed: true });
    setSpend(10_000);
    const second = await assertCompanyAiBudget(prisma, budgetConfig, 'co-live');

    assert.equal(second.allowed, false, 'the spend meter is the one value that must never be stale');
    assert.equal(reads.spend, 2);
    assert.equal(reads.budget, 1, 'only the config half is cached');
  });

  it('treats a missing aggregate row as zero spend', async () => {
    const { prisma } = budgetPrisma({ monthlyBudgetSatang: 1 });
    assert.deepEqual(await assertCompanyAiBudget(prisma, budgetConfig, 'co-no-aggregate'), { allowed: true });
  });
});

describe('assertCompanyAiBudget refusal and fail-closed', () => {
  it('refuses at spend >= budget and emits ai.company_budget.exceeded with riskLevel HIGH', async () => {
    const { prisma } = budgetPrisma({ monthlyBudgetSatang: 40_000, spendSatang: 40_000 });

    const decision = await assertCompanyAiBudget(prisma, budgetConfig, 'co-exceeded');

    assert.equal(decision.allowed, false);
    assert.deepEqual(warnings.find((w) => w?.msg === 'ai.company_budget.exceeded'), {
      companyId: 'co-exceeded',
      spendSatang: 40_000,
      budgetSatang: 40_000,
      override: true,
      msg: 'ai.company_budget.exceeded',
      riskLevel: 'HIGH',
    });
  });

  it('stays silent while the company is under budget', async () => {
    const { prisma } = budgetPrisma({ spendSatang: 1 });

    assert.deepEqual(await assertCompanyAiBudget(prisma, budgetConfig, 'co-under'), { allowed: true });
    assert.equal(warnings.filter((w) => w?.msg === 'ai.company_budget.exceeded').length, 0);
  });

  it('fails closed as unavailable when the budget read throws — never an unmetered pass', async () => {
    const prisma = {
      client: {
        companyAiConfiguration: { findUnique: async () => { throw new Error('DB_DOWN'); } },
        companyAiMonthlyUsage: { findUnique: async () => assert.fail('spend must not be read after a failed budget read') },
      },
    } as any;

    assert.deepEqual(await assertCompanyAiBudget(prisma, budgetConfig, 'co-budget-down'), {
      allowed: false,
      reason: 'unavailable',
    });
    assert.equal(warnings.filter((w) => w?.msg === 'ai.budget.read_failed').length, 1);
    assert.equal(warnings.filter((w) => w?.msg === 'ai.company_budget.exceeded').length, 0, 'an outage is not exhaustion');
  });

  it('fails closed as unavailable when the spend read throws', async () => {
    const prisma = {
      client: {
        companyAiConfiguration: { findUnique: async () => null },
        companyAiMonthlyUsage: { findUnique: async () => { throw new Error('DB_DOWN'); } },
      },
    } as any;

    assert.deepEqual(await assertCompanyAiBudget(prisma, budgetConfig, 'co-spend-down'), {
      allowed: false,
      reason: 'unavailable',
    });
  });

  it('fails closed when the platform default is not configured (stale packages/config dist)', async () => {
    const { prisma } = budgetPrisma({ spendSatang: 0 });

    // `aiMonthlyBudgetSatang` undefined would otherwise make `0 >= undefined` false and pass
    // every call unmetered — the silent-degradation shape this project refuses to ship.
    assert.deepEqual(await assertCompanyAiBudget(prisma, { aiThbPerUsd: 33 } as any, 'co-unconfigured'), {
      allowed: false,
      reason: 'unavailable',
    });
  });

  it('fails closed when the ledger delegate is missing entirely (no meter, no pass)', async () => {
    const prisma = { client: { companyAiConfiguration: { findUnique: async () => null } } } as any;

    assert.deepEqual(await assertCompanyAiBudget(prisma, budgetConfig, 'co-no-delegate'), {
      allowed: false,
      reason: 'unavailable',
    });
  });
});

describe('recordCompanyAiUsage 80% threshold event', () => {
  const meta = { companyId: 'co-threshold', sourceRoute: 'line-turn' };
  const thresholdEvents = () => warnings.filter((w) => w?.msg === 'ai.company_budget.threshold');

  it('emits exactly once for the recording that crosses 80%, and never again', async () => {
    // Budget 1,000 satang → the line sits at 800. Each usage() entry costs 347.
    const { prisma } = fakePrisma(1_000);

    await recordCompanyAiUsage(prisma, budgetConfig, meta, [usage(), usage()]); // 0 → 694
    assert.equal(thresholdEvents().length, 0, 'still under the line');

    await recordCompanyAiUsage(prisma, budgetConfig, meta, [usage()]); // 694 → 1041, crosses 800
    assert.equal(thresholdEvents().length, 1);
    assert.deepEqual(thresholdEvents()[0], {
      companyId: 'co-threshold',
      spendSatang: 1_041,
      budgetSatang: 1_000,
      override: true,
      msg: 'ai.company_budget.threshold',
      riskLevel: 'HIGH',
    });

    await recordCompanyAiUsage(prisma, budgetConfig, meta, [usage()]); // 1041 → 1388, already past
    assert.equal(thresholdEvents().length, 1, 'once per company-month by construction, not once per call');
  });

  it('emits once, not twice, when two concurrent recordings straddle the line', async () => {
    // The exactly-once claim rests on the unique aggregate row serializing increments, so the
    // interesting case is two recordings in flight at once: both land past 800, only the one
    // whose `pre` was still below it may report the crossing.
    const { prisma } = fakePrisma(1_000);
    await recordCompanyAiUsage(prisma, budgetConfig, meta, [usage(), usage()]); // 0 → 694, under

    await Promise.all([
      recordCompanyAiUsage(prisma, budgetConfig, meta, [usage()]), // 694 → 1041, crosses
      recordCompanyAiUsage(prisma, budgetConfig, meta, [usage()]), // 1041 → 1388, already past
    ]);

    assert.equal(thresholdEvents().length, 1, 'a serialized row cannot hand the crossing to two callers');
    assert.equal(thresholdEvents()[0].spendSatang, 1_041);
  });

  it('does not emit against the platform default until 80% of it is crossed', async () => {
    const { prisma } = fakePrisma(); // no row → inherits aiMonthlyBudgetSatang (200,000; line at 160,000)

    await recordCompanyAiUsage(prisma, budgetConfig, meta, [usage()]);

    assert.equal(thresholdEvents().length, 0);
  });
});

// ── FX rate stamped on every row (spec §6.4, criterion 15) ──────────────────────────

describe('recordCompanyAiUsage FX stamping', () => {
  it('stamps the resolved rate AND its provenance on every row it writes', async () => {
    const { prisma, transactions } = fakePrisma();

    await recordCompanyAiUsage(prisma, config, { companyId: 'co-1', sourceRoute: 'line-turn' }, [usage(), usage()]);

    const created = transactions[0]![0]!.args.data;
    assert.deepEqual(created.map((row: any) => row.thbPerUsd), [33, 33]);
    // No `aiFxRate` delegate on this fake, so the resolver degrades to the env rate — and the
    // row says so, which is the whole point of the addendum (spec §6.4, criterion 15).
    assert.deepEqual(created.map((row: any) => row.thbPerUsdSource), ['env-fallback', 'env-fallback']);
    // costSatang is reproducible from the row alone: 347 satang is exactly this usage at 33.
    assert.deepEqual(created.map((row: any) => row.costSatang), [347, 347]);
  });

  it('carries a non-default resolver source verbatim onto the rows', async () => {
    const { prisma, transactions } = fakePrisma();
    // With the delegate present the resolver reaches its stored-row branch; a deliberately
    // failing fetch is what gets it there.
    prisma.client.aiFxRate = {
      findUnique: async () => ({ rate: 36.5, fetchedAt: new Date() }),
      upsert: async () => ({}),
    };
    (globalThis as any).fetch = async () => { throw new Error('offline'); };

    await recordCompanyAiUsage(prisma, config, { companyId: 'co-1', sourceRoute: 'line-turn' }, [usage()]);

    const [row] = transactions[0]![0]!.args.data;
    assert.deepEqual(
      { thbPerUsd: row.thbPerUsd, thbPerUsdSource: row.thbPerUsdSource, costSatang: row.costSatang },
      { thbPerUsd: 36.5, thbPerUsdSource: 'stored', costSatang: 383 },
    );
  });

  it('applies a changed rate to new rows only — history is never re-priced', async () => {
    const { prisma, transactions } = fakePrisma();
    const meta = { companyId: 'co-1', sourceRoute: 'line-turn' };

    await recordCompanyAiUsage(prisma, { aiThbPerUsd: 33 } as any, meta, [usage()]);
    await recordCompanyAiUsage(prisma, { aiThbPerUsd: 40 } as any, meta, [usage()]);

    const [first] = transactions[0]![0]!.args.data;
    const [second] = transactions[1]![0]!.args.data;
    assert.deepEqual({ thbPerUsd: first.thbPerUsd, costSatang: first.costSatang }, { thbPerUsd: 33, costSatang: 347 });
    assert.deepEqual({ thbPerUsd: second.thbPerUsd, costSatang: second.costSatang }, { thbPerUsd: 40, costSatang: 420 });
  });
});

// ── Platform budget settings, DB row before env (spec §7.4, criteria 16–17) ─────────

const platformConfig = {
  aiThbPerUsd: 33,
  aiMonthlyBudgetSatang: 200_000,
  aiMonthlyBudgetSatangCeiling: 1_000_000,
} as any;

/** The single-row platform delegate, with reads counted so caching is observable. */
function platformPrisma(row: { monthlyBudgetSatang: number; ceilingSatang: number } | null, companyRow?: unknown) {
  const reads = { platform: 0 };
  const client = {
    platformAiBudgetConfig: {
      findUnique: async () => { reads.platform += 1; return row; },
    },
    companyAiConfiguration: { findUnique: async () => companyRow ?? null },
    companyAiMonthlyUsage: { findUnique: async () => ({ costSatang: 0 }) },
  };
  return { prisma: { client } as any, reads };
}

describe('resolvePlatformAiBudget', () => {
  it('prefers the DB row over the env values and labels both sources', async () => {
    const { prisma } = platformPrisma({ monthlyBudgetSatang: 700_000, ceilingSatang: 900_000 });

    assert.deepEqual(await resolvePlatformAiBudget(prisma, platformConfig), {
      monthlyBudgetSatang: 700_000,
      ceilingSatang: 900_000,
      monthlyBudgetSource: 'db',
      ceilingSource: 'db',
    });
  });

  it('falls back to the env values when no row exists', async () => {
    const { prisma } = platformPrisma(null);

    assert.deepEqual(await resolvePlatformAiBudget(prisma, platformConfig), {
      monthlyBudgetSatang: 200_000,
      ceilingSatang: 1_000_000,
      monthlyBudgetSource: 'env',
      ceilingSource: 'env',
    });
  });

  it('degrades to the env values when the delegate is missing (old unit fakes)', async () => {
    const resolved = await resolvePlatformAiBudget({ client: {} } as any, platformConfig);
    assert.equal(resolved.monthlyBudgetSatang, 200_000);
    assert.equal(resolved.monthlyBudgetSource, 'env');
  });

  it('shares the 60s budget cache and its reset', async () => {
    const { prisma, reads } = platformPrisma({ monthlyBudgetSatang: 700_000, ceilingSatang: 900_000 });
    mock.timers.enable({ apis: ['Date'] });
    try {
      await resolvePlatformAiBudget(prisma, platformConfig);
      await resolvePlatformAiBudget(prisma, platformConfig);
      assert.equal(reads.platform, 1, 'one read per TTL window, not one per AI call');

      mock.timers.tick(60_001);
      await resolvePlatformAiBudget(prisma, platformConfig);
      assert.equal(reads.platform, 2);

      __resetCompanyAiBudgetCache();
      await resolvePlatformAiBudget(prisma, platformConfig);
      assert.equal(reads.platform, 3, 'a settings write must bind immediately in its own process');
    } finally {
      mock.timers.reset();
    }
  });
});

describe('assertCompanyAiBudget against the platform settings row', () => {
  it('enforces the DB platform default for a company without an override', async () => {
    const { prisma } = platformPrisma({ monthlyBudgetSatang: 1_000, ceilingSatang: 900_000 });
    const client = prisma.client;
    client.companyAiMonthlyUsage.findUnique = async () => ({ costSatang: 1_000 });

    assert.deepEqual(await assertCompanyAiBudget(prisma, platformConfig, 'co-platform'), {
      allowed: false,
      reason: 'exceeded',
      spendSatang: 1_000,
      budgetSatang: 1_000,
      override: false,
    });
  });

  it('fails closed when the platform settings read throws', async () => {
    const prisma = {
      client: {
        companyAiConfiguration: { findUnique: async () => null },
        platformAiBudgetConfig: { findUnique: async () => { throw new Error('DB_DOWN'); } },
        companyAiMonthlyUsage: { findUnique: async () => ({ costSatang: 0 }) },
      },
    } as any;

    assert.deepEqual(await assertCompanyAiBudget(prisma, platformConfig, 'co-platform-down'), {
      allowed: false,
      reason: 'unavailable',
    });
  });

  it('keeps enforcing an override above a later-lowered ceiling (grandfathered)', async () => {
    // The ceiling gates writes only: this company was allowed ฿9,000 under an older, higher
    // ceiling, and lowering the platform ceiling to ฿1,000 must not silently cut its cap.
    const { prisma, reads } = platformPrisma(
      { monthlyBudgetSatang: 200_000, ceilingSatang: 100_000 },
      { monthlyBudgetSatang: 900_000 },
    );
    prisma.client.companyAiMonthlyUsage.findUnique = async () => ({ costSatang: 850_000 });

    assert.deepEqual(await assertCompanyAiBudget(prisma, platformConfig, 'co-grandfathered'), { allowed: true });
    assert.equal(reads.platform, 0, 'a read never consults the platform row when an override exists');
  });
});
