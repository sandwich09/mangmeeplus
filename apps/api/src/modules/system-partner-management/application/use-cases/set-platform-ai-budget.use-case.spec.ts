import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { UnprocessableEntityException } from '@nestjs/common';
import { SetPlatformAiBudgetUseCase } from './set-platform-ai-budget.use-case';
import {
  __resetCompanyAiBudgetCache,
  resolvePlatformAiBudget,
} from '../../../line-ai/application/company-ai-usage-meter';

const config = { aiMonthlyBudgetSatang: 200_000, aiMonthlyBudgetSatangCeiling: 1_000_000 } as any;

const makeCmd = (fields: { monthlyBudgetSatang: number; ceilingSatang: number }) => ({
  ...fields,
  requestingAdminUserId: 'admin-1',
  requestId: 'req-1',
});

function makePrisma(
  existing: { monthlyBudgetSatang: number; ceilingSatang: number } | null = null,
  /** Companies that INHERIT the default and carry an active or scheduled split allocation. */
  inheriting: Array<{ companyId: string; budgetMode: string; chatMonthlyBudgetSatang: number | null; ocrMonthlyBudgetSatang: number | null; pendingBudgetPolicy: unknown }> = [],
) {
  let upsertArgs: any = null;
  let auditData: any = null;
  let txCalled = false;
  let inheritingWhere: any = null;

  const txClient = {
    $executeRaw: async () => {},
    companyAiConfiguration: { findMany: async (args: any) => { inheritingWhere = args.where; return inheriting; } },
    platformAiBudgetConfig: {
      findUnique: async () => existing,
      upsert: async (args: any) => {
        upsertArgs = args;
        return { monthlyBudgetSatang: args.create.monthlyBudgetSatang, ceilingSatang: args.create.ceilingSatang };
      },
    },
    auditLog: { create: async (args: any) => { auditData = args.data; return {}; } },
  };

  return {
    upsertArgs: () => upsertArgs,
    auditData: () => auditData,
    txCalled: () => txCalled,
    inheritingWhere: () => inheritingWhere,
    client: {
      platformAiBudgetConfig: { findUnique: async () => { throw new Error('Unprotected audit predecessor'); } },
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
        txCalled = true;
        return fn(txClient);
      },
    },
  } as any;
}

describe('SetPlatformAiBudgetUseCase validation', () => {
  beforeEach(() => __resetCompanyAiBudgetCache());

  it('rejects a ceiling below the default and persists nothing', async () => {
    const prisma = makePrisma();
    await assert.rejects(
      () => new SetPlatformAiBudgetUseCase(prisma, config).execute(makeCmd({ monthlyBudgetSatang: 500_000, ceilingSatang: 499_999 })),
      (err: unknown) => {
        assert.ok(err instanceof UnprocessableEntityException);
        assert.match((err as Error).message, /499999.*500000/);
        return true;
      },
    );
    assert.equal(prisma.txCalled(), false);
    assert.equal(prisma.upsertArgs(), null);
  });

  it('accepts a ceiling exactly equal to the default', async () => {
    const prisma = makePrisma();
    const result = await new SetPlatformAiBudgetUseCase(prisma, config).execute(
      makeCmd({ monthlyBudgetSatang: 500_000, ceilingSatang: 500_000 }),
    );
    assert.equal(result.ceilingSatang, 500_000);
  });

  for (const fields of [
    { monthlyBudgetSatang: 0, ceilingSatang: 1_000 },
    { monthlyBudgetSatang: -1, ceilingSatang: 1_000 },
    { monthlyBudgetSatang: 1_000, ceilingSatang: 0 },
    { monthlyBudgetSatang: 1.5, ceilingSatang: 1_000 },
    { monthlyBudgetSatang: 1_000, ceilingSatang: 2_000.5 },
  ]) {
    it(`rejects ${JSON.stringify(fields)} and persists nothing`, async () => {
      const prisma = makePrisma();
      await assert.rejects(
        () => new SetPlatformAiBudgetUseCase(prisma, config).execute(makeCmd(fields)),
        UnprocessableEntityException,
      );
      assert.equal(prisma.txCalled(), false);
    });
  }
});

describe('SetPlatformAiBudgetUseCase write', () => {
  beforeEach(() => __resetCompanyAiBudgetCache());

  it('upserts the single row and audits CRITICAL before/after in the same transaction', async () => {
    const prisma = makePrisma({ monthlyBudgetSatang: 200_000, ceilingSatang: 1_000_000 });

    const result = await new SetPlatformAiBudgetUseCase(prisma, config).execute(
      makeCmd({ monthlyBudgetSatang: 300_000, ceilingSatang: 800_000 }),
    );

    assert.equal(prisma.txCalled(), true);
    assert.deepEqual(prisma.upsertArgs().where, { id: 'platform' });
    assert.equal(prisma.upsertArgs().create.id, 'platform');
    assert.equal(prisma.upsertArgs().update.updatedBySystemAdminUserId, 'admin-1');

    const audit = prisma.auditData();
    assert.equal(audit.riskLevel, 'CRITICAL');
    assert.equal(audit.action, 'system.platform_ai_budget.update');
    assert.equal(audit.targetId, 'platform');
    assert.equal(audit.requestId, 'req-1');
    assert.deepEqual({ ...audit.metadataJson }, {
      fromMonthlyBudgetSatang: 200_000,
      toMonthlyBudgetSatang: 300_000,
      fromCeilingSatang: 1_000_000,
      toCeilingSatang: 800_000,
    });

    assert.deepEqual(result, {
      monthlyBudgetSatang: 300_000,
      ceilingSatang: 800_000,
      source: { monthlyBudgetSatang: 'db', ceilingSatang: 'db' },
      envDefaults: { monthlyBudgetSatang: 200_000, ceilingSatang: 1_000_000 },
    });
  });

  it('records the first write as a transition away from the env fallbacks', async () => {
    const prisma = makePrisma(null);

    await new SetPlatformAiBudgetUseCase(prisma, config).execute(
      makeCmd({ monthlyBudgetSatang: 300_000, ceilingSatang: 800_000 }),
    );

    const { fromMonthlyBudgetSatang, fromCeilingSatang } = prisma.auditData().metadataJson;
    assert.deepEqual({ fromMonthlyBudgetSatang, fromCeilingSatang }, { fromMonthlyBudgetSatang: null, fromCeilingSatang: null });
  });

  it('resets the meter cache so the new default binds immediately', async () => {
    // The cache is module-level: prime it by hand, then check the use case cleared it.
    let reads = 0;
    const meterPrisma = {
      client: {
        platformAiBudgetConfig: {
          findUnique: async () => { reads += 1; return { monthlyBudgetSatang: 200_000, ceilingSatang: 1_000_000 }; },
        },
      },
    } as any;

    __resetCompanyAiBudgetCache();
    await resolvePlatformAiBudget(meterPrisma, config);
    await resolvePlatformAiBudget(meterPrisma, config);
    assert.equal(reads, 1, 'primed');

    await new SetPlatformAiBudgetUseCase(makePrisma(), config).execute(
      makeCmd({ monthlyBudgetSatang: 300_000, ceilingSatang: 800_000 }),
    );

    await resolvePlatformAiBudget(meterPrisma, config);
    assert.equal(reads, 2, 'the write must drop the cached platform row');
  });
});

// ── Split allocations of inheriting companies (spec §12.4, review F-05/R-06) ────────

const SPLIT_30_70 = { companyId: 'co-split', budgetMode: 'SPLIT', chatMonthlyBudgetSatang: 30, ocrMonthlyBudgetSatang: 70, pendingBudgetPolicy: null };
const SCHEDULED_30_70 = {
  companyId: 'co-scheduled', budgetMode: 'SHARED', chatMonthlyBudgetSatang: null, ocrMonthlyBudgetSatang: null,
  pendingBudgetPolicy: { mode: 'SPLIT', chatMonthlyBudgetSatang: 30, ocrMonthlyBudgetSatang: 70, effectiveMonthKey: '2026-10' },
};

describe('SetPlatformAiBudgetUseCase split-allocation guard', () => {
  beforeEach(() => __resetCompanyAiBudgetCache());

  for (const [name, rows] of [['an ACTIVE split', [SPLIT_30_70]], ['a SCHEDULED split', [SCHEDULED_30_70]]] as const) {
    it(`refuses lowering the DEFAULT under ${name} of an inheriting company, naming it`, async () => {
      const prisma = makePrisma({ monthlyBudgetSatang: 100, ceilingSatang: 1_000_000 }, [...rows]);
      await assert.rejects(
        () => new SetPlatformAiBudgetUseCase(prisma, config).execute(makeCmd({ monthlyBudgetSatang: 99, ceilingSatang: 1_000_000 })),
        (err: unknown) => {
          assert.ok(err instanceof UnprocessableEntityException);
          const body = (err as UnprocessableEntityException).getResponse() as any;
          assert.equal(body.code, 'platform_ai_budget_default_below_split_allocation');
          assert.equal(body.affectedCompanyCount, 1);
          assert.deepEqual(body.affectedCompanyIds, [rows[0]!.companyId]);
          return true;
        },
      );
      assert.equal(prisma.upsertArgs(), null, 'nothing is saved; the shop must not stop silently after a green save');
      assert.equal(prisma.auditData(), null);
    });
  }

  it('reads only companies that inherit the default, and never takes a company lock (canonical order)', async () => {
    const prisma = makePrisma({ monthlyBudgetSatang: 100, ceilingSatang: 1_000_000 }, []);
    await new SetPlatformAiBudgetUseCase(prisma, config).execute(makeCmd({ monthlyBudgetSatang: 99, ceilingSatang: 1_000_000 }));
    assert.equal(prisma.inheritingWhere().monthlyBudgetSatang, null, 'a company with its own override is unaffected');
  });

  it('allows the lowering when every allocation still fits, and when the default is RAISED', async () => {
    const fits = makePrisma({ monthlyBudgetSatang: 200, ceilingSatang: 1_000_000 }, [SPLIT_30_70]);
    assert.equal((await new SetPlatformAiBudgetUseCase(fits, config).execute(makeCmd({ monthlyBudgetSatang: 100, ceilingSatang: 1_000_000 }))).monthlyBudgetSatang, 100);
    const raised = makePrisma({ monthlyBudgetSatang: 10, ceilingSatang: 1_000_000 }, [SPLIT_30_70]);
    assert.equal((await new SetPlatformAiBudgetUseCase(raised, config).execute(makeCmd({ monthlyBudgetSatang: 1_000, ceilingSatang: 1_000_000 }))).monthlyBudgetSatang, 1_000);
    assert.equal(raised.inheritingWhere(), null, 'raising cannot break an allocation, so it reads nothing');
  });

  it('keeps CEILING grandfathering distinct: lowering the ceiling alone never inspects allocations', async () => {
    // The ceiling gates NEW per-company overrides; it is not an effective cap, so an existing
    // split allocation above it is untouched — exactly today's behaviour (spec §12.4).
    const prisma = makePrisma({ monthlyBudgetSatang: 100, ceilingSatang: 1_000_000 }, [SPLIT_30_70]);
    const result = await new SetPlatformAiBudgetUseCase(prisma, config).execute(makeCmd({ monthlyBudgetSatang: 100, ceilingSatang: 100 }));
    assert.equal(result.ceilingSatang, 100);
    assert.equal(prisma.inheritingWhere(), null, 'the default did not move, so no allocation can have been invalidated');
  });
});
