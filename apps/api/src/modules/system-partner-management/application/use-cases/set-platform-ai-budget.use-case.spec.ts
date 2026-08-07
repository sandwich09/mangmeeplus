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

function makePrisma(existing: { monthlyBudgetSatang: number; ceilingSatang: number } | null = null) {
  let upsertArgs: any = null;
  let auditData: any = null;
  let txCalled = false;

  const txClient = {
    platformAiBudgetConfig: {
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
    client: {
      platformAiBudgetConfig: { findUnique: async () => existing },
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
