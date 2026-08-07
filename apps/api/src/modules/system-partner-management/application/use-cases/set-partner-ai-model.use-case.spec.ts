import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { SetPartnerAiModelUseCase } from './set-partner-ai-model.use-case';
import { __resetCompanyAiBudgetCache, assertCompanyAiBudget } from '../../../line-ai/application/company-ai-usage-meter';

const APPROVED = 'global.anthropic.claude-sonnet-4-6';
const CEILING = 50_000_000; // ฿500,000

function makeConfig() {
  return {
    approvedAiModelIds: [APPROVED, 'global.anthropic.claude-haiku-4-5-20251001-v1:0'],
    aiMonthlyBudgetSatang: 5_000_000,
    aiMonthlyBudgetSatangCeiling: CEILING,
  } as any;
}

function makeCmd(fields: { modelId?: string; monthlyBudgetSatang?: number | null }) {
  return { companyId: 'co-1', ...fields, requestingAdminUserId: 'admin-1', requestId: 'req-1' };
}

function makePrisma(opts: {
  companyFound?: boolean;
  status?: string;
  existing?: { modelId: string | null; monthlyBudgetSatang: number | null } | null;
  /** Absent = no delegate at all (the pre-phase-6 fake), `null` = a delegate with no row. */
  platform?: { monthlyBudgetSatang: number; ceilingSatang: number } | null;
} = {}) {
  const companyFound = opts.companyFound ?? true;
  const status = opts.status ?? 'ACTIVE';
  const existing = opts.existing === undefined ? null : opts.existing;
  let upsertArgs: any = null;
  let auditData: any = null;
  let txCalled = false;

  const txClient = {
    companyAiConfiguration: {
      upsert: async (args: any) => {
        upsertArgs = args;
        // Mirror the DB: create when no row exists, otherwise apply only the provided fields.
        const next = existing
          ? { modelId: 'modelId' in args.update ? args.update.modelId : existing.modelId,
              monthlyBudgetSatang: 'monthlyBudgetSatang' in args.update ? args.update.monthlyBudgetSatang : existing.monthlyBudgetSatang }
          : { modelId: args.create.modelId, monthlyBudgetSatang: args.create.monthlyBudgetSatang };
        return { companyId: 'co-1', ...next, updatedAt: new Date('2026-07-29T00:00:00.000Z') };
      },
    },
    auditLog: { create: async (args: any) => { auditData = args.data; return {}; } },
  };

  return {
    upsertArgs: () => upsertArgs,
    auditData: () => auditData,
    txCalled: () => txCalled,
    client: {
      company: { findUnique: async () => (companyFound ? { id: 'co-1', status } : null) },
      companyAiConfiguration: { findUnique: async () => existing },
      ...(opts.platform === undefined
        ? {}
        : { platformAiBudgetConfig: { findUnique: async () => opts.platform } }),
      // Callback form — the use case runs an interactive transaction, not an ops array.
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
        txCalled = true;
        return fn(txClient);
      },
    },
  } as any;
}

describe('SetPartnerAiModelUseCase', () => {
  beforeEach(() => __resetCompanyAiBudgetCache());

  it('rejects an empty body — nothing to update', async () => {
    const prisma = makePrisma();
    const useCase = new SetPartnerAiModelUseCase(prisma, makeConfig());
    await assert.rejects(() => useCase.execute(makeCmd({})), UnprocessableEntityException);
    assert.equal(prisma.txCalled(), false);
  });

  it('throws NotFoundException when the company does not exist', async () => {
    const prisma = makePrisma({ companyFound: false });
    const useCase = new SetPartnerAiModelUseCase(prisma, makeConfig());
    await assert.rejects(() => useCase.execute(makeCmd({ monthlyBudgetSatang: 100 })), NotFoundException);
    assert.equal(prisma.txCalled(), false);
  });

  for (const lockedStatus of ['DISABLED', 'ARCHIVED']) {
    it(`skips the transaction when the company is ${lockedStatus}`, async () => {
      const prisma = makePrisma({ status: lockedStatus });
      const useCase = new SetPartnerAiModelUseCase(prisma, makeConfig());
      await assert.rejects(() => useCase.execute(makeCmd({ monthlyBudgetSatang: 100 })), UnprocessableEntityException);
      assert.equal(prisma.txCalled(), false);
    });
  }

  it('rejects a model outside the approved list', async () => {
    const prisma = makePrisma();
    const useCase = new SetPartnerAiModelUseCase(prisma, makeConfig());
    await assert.rejects(() => useCase.execute(makeCmd({ modelId: 'openai.gpt-9' })), UnprocessableEntityException);
    assert.equal(prisma.txCalled(), false);
  });

  for (const budget of [0, -1, 1.5]) {
    it(`rejects monthlyBudgetSatang ${budget} and persists nothing`, async () => {
      const prisma = makePrisma();
      const useCase = new SetPartnerAiModelUseCase(prisma, makeConfig());
      await assert.rejects(
        () => useCase.execute(makeCmd({ monthlyBudgetSatang: budget })),
        (err: unknown) => { assert.ok(err instanceof UnprocessableEntityException); return true; },
      );
      assert.equal(prisma.txCalled(), false);
      assert.equal(prisma.upsertArgs(), null);
    });
  }

  it('rejects a budget above the ceiling naming it, and never clamps', async () => {
    const prisma = makePrisma();
    const useCase = new SetPartnerAiModelUseCase(prisma, makeConfig());
    await assert.rejects(
      () => useCase.execute(makeCmd({ monthlyBudgetSatang: CEILING + 1 })),
      (err: unknown) => {
        assert.ok(err instanceof UnprocessableEntityException);
        assert.match((err as Error).message, new RegExp(String(CEILING)));
        return true;
      },
    );
    assert.equal(prisma.txCalled(), false);
  });

  it('validates against the platform settings ceiling, not the env one, when a row exists', async () => {
    // The DB ceiling is BELOW the env ceiling: a write the env rule would allow must now fail.
    const prisma = makePrisma({ platform: { monthlyBudgetSatang: 100_000, ceilingSatang: 900_000 } });
    await assert.rejects(
      () => new SetPartnerAiModelUseCase(prisma, makeConfig()).execute(makeCmd({ monthlyBudgetSatang: 900_001 })),
      (err: unknown) => {
        assert.ok(err instanceof UnprocessableEntityException);
        assert.match((err as Error).message, /900000/);
        return true;
      },
    );
    assert.equal(prisma.txCalled(), false);
  });

  it('accepts a budget above the env ceiling when the platform row raises it', async () => {
    const prisma = makePrisma({ platform: { monthlyBudgetSatang: 100_000, ceilingSatang: CEILING * 2 } });
    const result = await new SetPartnerAiModelUseCase(prisma, makeConfig()).execute(
      makeCmd({ monthlyBudgetSatang: CEILING + 1 }),
    );
    assert.equal(result.monthlyBudgetSatang, CEILING + 1);
  });

  it('accepts exactly the ceiling', async () => {
    const prisma = makePrisma();
    const useCase = new SetPartnerAiModelUseCase(prisma, makeConfig());
    const result = await useCase.execute(makeCmd({ monthlyBudgetSatang: CEILING }));
    assert.equal(result.monthlyBudgetSatang, CEILING);
  });

  it('budget-only update leaves the configured model untouched', async () => {
    const prisma = makePrisma({ existing: { modelId: APPROVED, monthlyBudgetSatang: null } });
    const useCase = new SetPartnerAiModelUseCase(prisma, makeConfig());
    const result = await useCase.execute(makeCmd({ monthlyBudgetSatang: 900_000 }));
    assert.equal('modelId' in prisma.upsertArgs().update, false, 'update must not mention modelId');
    assert.equal(result.modelId, APPROVED);
    assert.equal(result.monthlyBudgetSatang, 900_000);
  });

  it('model-only update leaves the budget override untouched', async () => {
    const prisma = makePrisma({ existing: { modelId: null, monthlyBudgetSatang: 900_000 } });
    const useCase = new SetPartnerAiModelUseCase(prisma, makeConfig());
    const result = await useCase.execute(makeCmd({ modelId: APPROVED }));
    assert.equal('monthlyBudgetSatang' in prisma.upsertArgs().update, false, 'update must not mention the budget');
    assert.equal(result.monthlyBudgetSatang, 900_000);
    assert.equal(result.modelId, APPROVED);
  });

  it('creates a fresh row with the absent field inherited (null)', async () => {
    const prisma = makePrisma({ existing: null });
    const useCase = new SetPartnerAiModelUseCase(prisma, makeConfig());
    const result = await useCase.execute(makeCmd({ monthlyBudgetSatang: 250_000 }));
    assert.equal(prisma.upsertArgs().create.modelId, null);
    assert.equal(prisma.upsertArgs().create.monthlyBudgetSatang, 250_000);
    assert.equal(result.modelId, null);
  });

  it('clearing the override records the transition to inherited in a CRITICAL audit row', async () => {
    const prisma = makePrisma({ existing: { modelId: APPROVED, monthlyBudgetSatang: 900_000 } });
    const useCase = new SetPartnerAiModelUseCase(prisma, makeConfig());
    const result = await useCase.execute(makeCmd({ monthlyBudgetSatang: null }));

    assert.equal(result.monthlyBudgetSatang, null);
    const audit = prisma.auditData();
    assert.equal(audit.riskLevel, 'CRITICAL');
    assert.equal(audit.action, 'system.partner_ai_model.update');
    assert.equal(audit.metadataJson.fromMonthlyBudgetSatang, 900_000);
    assert.equal(audit.metadataJson.toMonthlyBudgetSatang, null);
    assert.equal(audit.metadataJson.fromModelId, APPROVED);
    assert.equal(audit.metadataJson.toModelId, APPROVED);
  });

  it('writes before/after for BOTH fields when both change, inside the same transaction', async () => {
    const prisma = makePrisma({ existing: { modelId: null, monthlyBudgetSatang: null } });
    const useCase = new SetPartnerAiModelUseCase(prisma, makeConfig());
    await useCase.execute(makeCmd({ modelId: APPROVED, monthlyBudgetSatang: 700_000 }));

    const audit = prisma.auditData();
    assert.deepEqual(
      { ...audit.metadataJson },
      { fromModelId: null, toModelId: APPROVED, fromMonthlyBudgetSatang: null, toMonthlyBudgetSatang: 700_000 },
    );
    assert.equal(prisma.txCalled(), true);
  });

  it('resets the meter budget cache after a budget write, but not for a model-only write', async () => {
    // The cache is module-level: prime it by hand, then check whether the use case cleared it.
    const primeCache = async (prisma: any) => {
      const decision = await assertCompanyAiBudget(prisma, makeConfig(), 'co-1');
      assert.equal(decision.allowed, true, 'meter fake must be readable, not fail-closed');
    };
    // Counting the config reads is what makes a stale cache observable: a cached entry skips it.
    let configReads = 0;
    const meterPrisma = {
      client: {
        companyAiConfiguration: {
          findUnique: async () => { configReads += 1; return { monthlyBudgetSatang: configReads === 1 ? 900_000 : null }; },
        },
        companyAiMonthlyUsage: { findUnique: async () => ({ costSatang: 0 }) },
      },
    } as any;

    for (const [fields, expectReset] of [
      [{ monthlyBudgetSatang: 100 }, true],
      [{ modelId: APPROVED }, false],
    ] as const) {
      configReads = 0;
      __resetCompanyAiBudgetCache();
      await primeCache(meterPrisma);
      assert.equal(configReads, 1);

      const prisma = makePrisma({ existing: { modelId: APPROVED, monthlyBudgetSatang: 900_000 } });
      await new SetPartnerAiModelUseCase(prisma, makeConfig()).execute(makeCmd(fields));

      await primeCache(meterPrisma);
      assert.equal(configReads, expectReset ? 2 : 1, `cache reset expected: ${expectReset}`);
    }
  });
});
