import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../../../generated/prisma/client';
import { pgSpecUnreachableReason } from '../../../../common/database/pg-spec-guard';
import { SetPartnerAiModelUseCase } from './set-partner-ai-model.use-case';
import { SetPartnerOcrConfigUseCase } from './set-partner-ocr-config.use-case';
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
  lockedStatus?: string;
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
  const lockOrder: string[] = [];

  const txClient = {
    $executeRaw: async (_sql: TemplateStringsArray, key: string) => { lockOrder.push(key); },
    $queryRaw: async (_sql: TemplateStringsArray, id: string) => { lockOrder.push(`company:${id}`); return []; },
    company: { findUnique: async () => (companyFound ? { id: 'co-1', status: opts.lockedStatus ?? status } : null) },
    companyAiConfiguration: {
      findUnique: async () => existing,
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
    lockOrder,
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
    assert.equal(audit.companyId, 'co-1');
    assert.equal(audit.actorUserId, 'admin-1');
    assert.equal(audit.metadataJson.source, 'ADMIN_ADJUSTMENT');
    assert.equal(audit.metadataJson.entryPoint, 'SYSTEM_PARTNER_ADMIN');
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
      { source: 'ADMIN_ADJUSTMENT', entryPoint: 'SYSTEM_PARTNER_ADMIN', fromModelId: null, toModelId: APPROVED, fromMonthlyBudgetSatang: null, toMonthlyBudgetSatang: 700_000 },
    );
    assert.equal(prisma.txCalled(), true);
  });

  it('reads the audit predecessor inside the shared configuration and Company locks', async () => {
    const prisma = makePrisma({ existing: { modelId: APPROVED, monthlyBudgetSatang: 321 } });
    prisma.client.companyAiConfiguration.findUnique = async () => { throw new Error('Unprotected configuration read'); };
    await new SetPartnerAiModelUseCase(prisma, makeConfig()).execute(makeCmd({ monthlyBudgetSatang: 400 }));
    assert.deepEqual(prisma.lockOrder, ['partner-ocr-config:co-1', 'company:co-1']);
    assert.equal(prisma.auditData().metadataJson.fromMonthlyBudgetSatang, 321);
    assert.equal(prisma.auditData().metadataJson.toMonthlyBudgetSatang, 400);
  });

  it('cannot save after a company was disabled between preflight and the locked write', async () => {
    const prisma = makePrisma({ status: 'ACTIVE', lockedStatus: 'DISABLED' });
    await assert.rejects(new SetPartnerAiModelUseCase(prisma, makeConfig()).execute(makeCmd({ monthlyBudgetSatang: 100 })), UnprocessableEntityException);
    assert.equal(prisma.upsertArgs(), null);
    assert.equal(prisma.auditData(), null);
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

function makeOcrPrisma(input: {
  existing?: { ocrEnabled: boolean; ocrMonthlyLimit: number | null; ocrConfigVersion?: number; receiptQuotaEnforced?: boolean | null };
  status?: string;
} = {}) {
  let saved = input.existing ? { ...input.existing, ocrConfigVersion: input.existing.ocrConfigVersion ?? 0 } : undefined;
  const audits: any[] = [];
  let upserts = 0;
  let locks = 0;
  const lockKeys: string[] = [];
  const tx = {
    $executeRaw: async (_strings: TemplateStringsArray, key: string) => { locks += 1; lockKeys.push(key); },
    $queryRaw: async () => [],
    company: { findUnique: async () => ({ id: 'co-1', status: input.status ?? 'ACTIVE' }) },
    companyAiConfiguration: {
      findUnique: async () => saved ? { ...saved, updatedAt: new Date('2026-08-20T00:00:00Z') } : null,
      upsert: async ({ create, update }: any) => {
        upserts += 1;
        saved = saved ? {
          ...saved,
          ocrEnabled: update.ocrEnabled,
          ocrMonthlyLimit: update.ocrMonthlyLimit,
          receiptQuotaEnforced: update.receiptQuotaEnforced,
          ocrConfigVersion: saved.ocrConfigVersion + update.ocrConfigVersion.increment,
        } : {
          ocrEnabled: create.ocrEnabled,
          ocrMonthlyLimit: create.ocrMonthlyLimit,
          receiptQuotaEnforced: create.receiptQuotaEnforced,
          ocrConfigVersion: create.ocrConfigVersion,
        };
        return { ...saved, updatedAt: new Date('2026-08-27T00:00:00Z') };
      },
    },
    auditLog: { create: async ({ data }: any) => { audits.push(data); return data; } },
  };
  return {
    prisma: { client: { $transaction: (fn: any) => fn(tx) } } as any,
    saved: () => saved,
    audits,
    upserts: () => upserts,
    locks: () => locks,
    lockKeys,
  };
}

const ocrCommand = (overrides: Partial<{
  receiptQuotaEnforced: boolean | null;
  enabled: boolean;
  monthlyLimit: number | null;
  expectedVersion: number;
  requestingAdminUserId: string;
  requestId: string;
}> = {}) => ({
  companyId: 'co-1',
  enabled: true,
  monthlyLimit: 100 as number | null,
  expectedVersion: 0,
  requestingAdminUserId: 'admin-1',
  requestId: 'req-1',
  ...overrides,
});

describe('SetPartnerOcrConfigUseCase', () => {
  it('preserves an omitted override and versions explicit enforce, observe and inheritance changes', async () => {
    const state = makeOcrPrisma({ existing: { ocrEnabled: true, ocrMonthlyLimit: 100, receiptQuotaEnforced: true, ocrConfigVersion: 3 } });
    const uc = new SetPartnerOcrConfigUseCase(state.prisma);
    assert.equal((await uc.execute(ocrCommand({ expectedVersion: 3 }))).receiptQuotaEnforced, true);
    assert.equal(state.audits.length, 0);
    const observed = await uc.execute(ocrCommand({ receiptQuotaEnforced: false, expectedVersion: 3 }));
    assert.equal(observed.receiptQuotaEnforced, false); assert.equal(observed.version, 4);
    await assert.rejects(uc.execute(ocrCommand({ receiptQuotaEnforced: true, expectedVersion: 3 })), ConflictException);
    const inherited = await uc.execute(ocrCommand({ receiptQuotaEnforced: null, expectedVersion: 4 }));
    assert.equal(inherited.receiptQuotaEnforced, null); assert.equal(inherited.version, 5);
    assert.equal(state.audits[1].metadataJson.fromReceiptQuotaEnforced, false);
    assert.equal(state.audits[1].metadataJson.toReceiptQuotaEnforced, null);
    await assert.rejects(uc.execute(ocrCommand({ receiptQuotaEnforced: 'false' as any, expectedVersion: 5 })), UnprocessableEntityException);
  });

  it('writes config and CRITICAL before/after audit in the same transaction', async () => {
    const state = makeOcrPrisma({ existing: { ocrEnabled: true, ocrMonthlyLimit: null, ocrConfigVersion: 3 } });
    const result = await new SetPartnerOcrConfigUseCase(state.prisma).execute(ocrCommand({
      enabled: false, monthlyLimit: 25, expectedVersion: 3,
    }));
    assert.deepEqual(
      { enabled: result.enabled, monthlyLimit: result.monthlyLimit, version: result.version },
      { enabled: false, monthlyLimit: 25, version: 4 },
    );
    assert.equal(state.locks(), 1);
    assert.deepEqual(state.lockKeys, ['partner-ocr-config:co-1']);
    assert.equal(state.audits.length, 1);
    assert.equal(state.audits[0].riskLevel, 'CRITICAL');
    assert.equal(state.audits[0].companyId, 'co-1');
    assert.equal(state.audits[0].actorUserId, 'admin-1');
    assert.deepEqual(state.audits[0].metadataJson, {
      source: 'ADMIN_ADJUSTMENT', entryPoint: 'SYSTEM_PARTNER_ADMIN',
      fromEnabled: true, toEnabled: false, fromMonthlyLimit: null, toMonthlyLimit: 25,
      fromReceiptQuotaEnforced: null, toReceiptQuotaEnforced: null,
      fromVersion: 3, toVersion: 4,
    });
  });

  it('is naturally idempotent: exact desired replay is a no-op even with a stale expected version', async () => {
    const state = makeOcrPrisma({ existing: { ocrEnabled: true, ocrMonthlyLimit: 100, ocrConfigVersion: 7 } });
    const result = await new SetPartnerOcrConfigUseCase(state.prisma).execute(ocrCommand({ expectedVersion: 2 }));
    assert.equal(result.updatedAt, '2026-08-20T00:00:00.000Z');
    assert.equal(result.version, 7);
    assert.equal(state.upserts(), 0);
    assert.equal(state.audits.length, 0);
  });

  it('prevents a stale second admin from overwriting, while the first admin replay stays safe', async () => {
    const state = makeOcrPrisma({ existing: { ocrEnabled: true, ocrMonthlyLimit: null, ocrConfigVersion: 2 } });
    const useCase = new SetPartnerOcrConfigUseCase(state.prisma);

    const first = await useCase.execute(ocrCommand({
      enabled: false, monthlyLimit: 25, expectedVersion: 2,
      requestingAdminUserId: 'admin-a', requestId: 'admin-a-command',
    }));
    assert.equal(first.version, 3);

    await assert.rejects(
      () => useCase.execute(ocrCommand({
        enabled: true, monthlyLimit: 50, expectedVersion: 2,
        requestingAdminUserId: 'admin-b', requestId: 'admin-b-command',
      })),
      (error: unknown) => error instanceof ConflictException
        && (error.getResponse() as any).code === 'ocr_config_version_conflict'
        && (error.getResponse() as any).currentVersion === 3,
    );
    assert.deepEqual(state.saved(), { ocrEnabled: false, ocrMonthlyLimit: 25, receiptQuotaEnforced: null, ocrConfigVersion: 3 });
    assert.equal(state.upserts(), 1);
    assert.equal(state.audits.length, 1);

    const replay = await useCase.execute(ocrCommand({
      enabled: false, monthlyLimit: 25, expectedVersion: 2,
      requestingAdminUserId: 'admin-a', requestId: 'admin-a-command',
    }));
    assert.equal(replay.version, 3);
    assert.equal(state.upserts(), 1);
    assert.equal(state.audits.length, 1);
  });

  it('real PostgreSQL: two admins cannot overwrite each other and the winning stale replay is a no-op', async (t) => {
    const databaseUrl = process.env.DATABASE_URL?.trim();
    if (!databaseUrl) {
      if (process.env.OCR_REQUIRE_POSTGRES === 'true') throw new Error('OCR PostgreSQL test database is required');
      return t.skip('DATABASE_URL is not set');
    }

    const clients = [
      new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) }),
      new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) }),
    ];
    let companyId = '';
    const adminIds: string[] = [];
    const runId = randomUUID();
    try {
      const unreachable = await pgSpecUnreachableReason(
        () => Promise.all(clients.map((client) => client.$queryRaw`SELECT 1`)), 'OCR_REQUIRE_POSTGRES');
      if (unreachable) return t.skip(unreachable);
      companyId = (await clients[0]!.company.create({
        data: { name: `ocr-cas-${process.pid}-${runId}`, status: 'ACTIVE' },
        select: { id: true },
      })).id;
      for (const name of ['A', 'B']) {
        adminIds.push((await clients[0]!.user.create({
          data: { displayName: `OCR CAS admin ${name} ${runId}` },
          select: { id: true },
        })).id);
      }
      const commands = [
        {
          companyId, enabled: false, monthlyLimit: null, expectedVersion: 0,
          requestingAdminUserId: adminIds[0]!, requestId: `ocr-cas-a-${runId}`,
        },
        {
          companyId, enabled: true, monthlyLimit: 25, expectedVersion: 0,
          requestingAdminUserId: adminIds[1]!, requestId: `ocr-cas-b-${runId}`,
        },
      ];

      const results = await Promise.allSettled(clients.map((client, index) =>
        new SetPartnerOcrConfigUseCase({ client } as any).execute(commands[index]!)));
      assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
      assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
      const rejected = results.find((result) => result.status === 'rejected') as PromiseRejectedResult;
      assert.ok(rejected.reason instanceof ConflictException);
      assert.equal((rejected.reason.getResponse() as any).code, 'ocr_config_version_conflict');

      const winnerIndex = results.findIndex((result) => result.status === 'fulfilled');
      const winner = results[winnerIndex] as PromiseFulfilledResult<any>;
      assert.equal(winner.value.version, 1);
      const replay = await new SetPartnerOcrConfigUseCase({ client: clients[0] } as any).execute(commands[winnerIndex]!);
      assert.equal(replay.version, 1);
      assert.equal(await clients[0]!.auditLog.count({
        where: { targetId: companyId, action: 'system.partner_ocr_config.update' },
      }), 1);
      assert.equal((await clients[0]!.companyAiConfiguration.findUniqueOrThrow({
        where: { companyId }, select: { ocrConfigVersion: true },
      })).ocrConfigVersion, 1);

      // Real concurrent AI edits must form one truthful before/after chain, even after OCR
      // created the shared row. Neither may claim the same obsolete predecessor.
      await Promise.all(clients.map((client, index) => new SetPartnerAiModelUseCase({ client } as any, makeConfig()).execute({
        companyId, monthlyBudgetSatang: [1234, 2345][index]!, requestingAdminUserId: adminIds[index]!, requestId: `ai-audit-${index}-${runId}`,
      })));
      const audits = await clients[0]!.auditLog.findMany({ where: { companyId, action: 'system.partner_ai_model.update' } });
      assert.equal(audits.length, 2);
      const first = audits.find(a => (a.metadataJson as any).fromMonthlyBudgetSatang === null)!;
      const second = audits.find(a => a.id !== first.id)!;
      assert.ok(first);
      assert.equal((second.metadataJson as any).fromMonthlyBudgetSatang, (first.metadataJson as any).toMonthlyBudgetSatang);
      for (const audit of audits) {
        assert.equal((audit.metadataJson as any).source, 'ADMIN_ADJUSTMENT');
        assert.equal((audit.metadataJson as any).entryPoint, 'SYSTEM_PARTNER_ADMIN');
        assert.ok(adminIds.includes(audit.actorUserId!));
        assert.equal(audit.targetId, companyId);
      }
      const current = await clients[0]!.companyAiConfiguration.findUniqueOrThrow({ where: { companyId } });
      assert.equal(current.monthlyBudgetSatang, (second.metadataJson as any).toMonthlyBudgetSatang);
      assert.equal(current.ocrConfigVersion, 1);
    } finally {
      if (companyId) {
        await clients[0]!.auditLog.deleteMany({ where: { targetId: companyId } });
        await clients[0]!.company.deleteMany({ where: { id: companyId } });
      }
      if (adminIds.length) await clients[0]!.user.deleteMany({ where: { id: { in: adminIds } } });
      await Promise.all(clients.map((client) => client.$disconnect().catch(() => undefined)));
    }
  });

  it('rejects invalid limits and locked company metadata before any write', async () => {
    for (const monthlyLimit of [0, 1.5, 1_000_001]) {
      const state = makeOcrPrisma();
      await assert.rejects(
        () => new SetPartnerOcrConfigUseCase(state.prisma).execute(ocrCommand({ monthlyLimit })),
        UnprocessableEntityException,
      );
      assert.equal(state.upserts(), 0);
    }
    await assert.rejects(
      () => new SetPartnerOcrConfigUseCase(makeOcrPrisma().prisma).execute(ocrCommand({ expectedVersion: -1 })),
      UnprocessableEntityException,
    );

    const locked = makeOcrPrisma({ status: 'DISABLED' });
    await assert.rejects(
      () => new SetPartnerOcrConfigUseCase(locked.prisma).execute(ocrCommand()),
      UnprocessableEntityException,
    );
    assert.equal(locked.upserts(), 0);
  });
});
