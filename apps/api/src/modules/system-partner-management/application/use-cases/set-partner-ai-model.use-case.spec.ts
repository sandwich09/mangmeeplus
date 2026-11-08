import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../../../generated/prisma/client';
import { pgSpecUnreachableReason } from '../../../../common/database/pg-spec-guard';
import type { PartnerAiBudgetPolicyInput } from '@watchdog-bms/contracts';
import { Prisma } from '../../../../generated/prisma/client';
import { SetPartnerAiModelUseCase, type SetPartnerAiModelCommand } from './set-partner-ai-model.use-case';
import { SetPartnerOcrConfigUseCase } from './set-partner-ocr-config.use-case';
import { aiAdjustmentDetails } from '../partner-ai-adjustment-history';
import { __resetCompanyAiBudgetCache, assertCompanyAiBudget, bangkokMonthKey } from '../../../line-ai/application/company-ai-usage-meter';
import { nextBangkokMonthKey } from '../../../line-ai/application/company-ai-budget-policy';

const APPROVED = 'global.anthropic.claude-sonnet-4-6';
const CEILING = 50_000_000; // ฿500,000

function makeConfig() {
  return {
    approvedAiModelIds: [APPROVED, 'global.anthropic.claude-haiku-4-5-20251001-v1:0'],
    aiMonthlyBudgetSatang: 5_000_000,
    aiMonthlyBudgetSatangCeiling: CEILING,
  } as any;
}

function makeCmd(fields: { modelId?: string; monthlyBudgetSatang?: number | null; expectedModelId?:string|null; expectedMonthlyBudgetSatang?:number|null; reason?:string }) {
  return { companyId: 'co-1', reason:'ปรับตามคำขอทดสอบ', expectedModelId:null, expectedMonthlyBudgetSatang:null, ...fields, requestingAdminUserId: 'admin-1', requestId: 'req-1' };
}

function makePrisma(opts: {
  companyFound?: boolean;
  status?: string;
  lockedStatus?: string;
  existing?: { modelId: string | null; monthlyBudgetSatang: number | null } | null;
  /** Absent = no delegate at all (the pre-phase-6 fake), `null` = a delegate with no row. */
  platform?: { monthlyBudgetSatang: number; ceilingSatang: number } | null;
  lockedPlatform?: { monthlyBudgetSatang: number; ceilingSatang: number };
} = {}) {
  const companyFound = opts.companyFound ?? true;
  const status = opts.status ?? 'ACTIVE';
  const existing = opts.existing === undefined ? null : opts.existing;
  let upsertArgs: any = null;
  let auditData: any = null;
  let txCalled = false;
  const lockOrder: string[] = [];

  const txClient = {
    platformAiBudgetConfig: { findUnique: async () => opts.lockedPlatform ?? opts.platform ?? null },
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

  it('requires a bounded reason, refuses stale previous values, and keeps exact replay unchanged', async () => {
    const prisma=makePrisma({existing:{modelId:APPROVED,monthlyBudgetSatang:500}});
    const uc=new SetPartnerAiModelUseCase(prisma,makeConfig());
    for(const reason of ['', '  ', 'x'.repeat(501)])await assert.rejects(uc.execute(makeCmd({monthlyBudgetSatang:600,reason})),UnprocessableEntityException);
    await assert.rejects(uc.execute(makeCmd({monthlyBudgetSatang:600,expectedMonthlyBudgetSatang:400})),ConflictException);
    await assert.rejects(uc.execute({...makeCmd({monthlyBudgetSatang:600}),expectedMonthlyBudgetSatang:undefined}),UnprocessableEntityException);
    const replay=await uc.execute(makeCmd({monthlyBudgetSatang:500,expectedMonthlyBudgetSatang:400}));
    assert.equal(replay.monthlyBudgetSatang,500);
    assert.equal(prisma.upsertArgs(),null);assert.equal(prisma.auditData(),null);
  });

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
    assert.equal(prisma.upsertArgs(), null);
    assert.equal(prisma.auditData(), null);
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
    assert.equal(prisma.upsertArgs(), null);
    assert.equal(prisma.auditData(), null);
  });

  it('checks the locked platform ceiling and preserves a previously committed replay', async () => {
    const opts={platform:{monthlyBudgetSatang:100,ceilingSatang:1000},lockedPlatform:{monthlyBudgetSatang:100,ceilingSatang:500}};
    const fresh=makePrisma(opts);
    await assert.rejects(new SetPartnerAiModelUseCase(fresh,makeConfig()).execute(makeCmd({monthlyBudgetSatang:600})),UnprocessableEntityException);
    assert.equal(fresh.upsertArgs(),null);assert.equal(fresh.auditData(),null);
    const replay=makePrisma({...opts,existing:{modelId:null,monthlyBudgetSatang:600}});
    assert.equal((await new SetPartnerAiModelUseCase(replay,makeConfig()).execute(makeCmd({monthlyBudgetSatang:600}))).monthlyBudgetSatang,600);
    assert.equal(replay.upsertArgs(),null);assert.equal(replay.auditData(),null);
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
    const result = await useCase.execute(makeCmd({ monthlyBudgetSatang: null, expectedMonthlyBudgetSatang:900_000 }));

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
      { source: 'ADMIN_ADJUSTMENT', entryPoint: 'SYSTEM_PARTNER_ADMIN', reason:'ปรับตามคำขอทดสอบ', fromModelId: null, toModelId: APPROVED, fromMonthlyBudgetSatang: null, toMonthlyBudgetSatang: 700_000,
        // Split policy before/after rides the SAME audit row (spec §12.4); a SHARED company's is all defaults.
        fromBudgetMode: 'SHARED', toBudgetMode: 'SHARED', fromChatMonthlyBudgetSatang: null, toChatMonthlyBudgetSatang: null,
        fromOcrMonthlyBudgetSatang: null, toOcrMonthlyBudgetSatang: null, fromBudgetConfigVersion: 0, toBudgetConfigVersion: 0,
        fromPendingBudgetPolicy: null, toPendingBudgetPolicy: null },
    );
    assert.equal(prisma.txCalled(), true);
  });

  it('reads the audit predecessor inside the shared configuration and Company locks', async () => {
    const prisma = makePrisma({ existing: { modelId: APPROVED, monthlyBudgetSatang: 321 } });
    prisma.client.companyAiConfiguration.findUnique = async () => { throw new Error('Unprotected configuration read'); };
    await new SetPartnerAiModelUseCase(prisma, makeConfig()).execute(makeCmd({ monthlyBudgetSatang: 400,expectedMonthlyBudgetSatang:321 }));
    // Phase E1b appends the company-month budget lock LAST, after the platform one (spec §12.7).
    assert.deepEqual(prisma.lockOrder, [
      'partner-ocr-config:co-1', 'company:co-1', 'platform-ai-budget', `ai-budget:co-1:${bangkokMonthKey()}`,
    ]);
    assert.equal(prisma.auditData().metadataJson.fromMonthlyBudgetSatang, 321);
    assert.equal(prisma.auditData().metadataJson.toMonthlyBudgetSatang, 400);
  });

  it('cannot save after a company was disabled between preflight and the locked write', async () => {
    const prisma = makePrisma({ status: 'ACTIVE', lockedStatus: 'DISABLED' });
    await assert.rejects(new SetPartnerAiModelUseCase(prisma, makeConfig()).execute(makeCmd({ monthlyBudgetSatang: 100 })), UnprocessableEntityException);
    assert.equal(prisma.upsertArgs(), null);
    assert.equal(prisma.auditData(), null);
  });

  it('admission always rereads its current budget after Admin writes', async () => {
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

    for (const fields of [
      { monthlyBudgetSatang: 100 },
      { modelId: APPROVED },
    ] as const) {
      configReads = 0;
      __resetCompanyAiBudgetCache();
      await primeCache(meterPrisma);
      assert.equal(configReads, 1);

      const prisma = makePrisma({ existing: { modelId: APPROVED, monthlyBudgetSatang: 900_000 } });
      await new SetPartnerAiModelUseCase(prisma, makeConfig()).execute(makeCmd({...fields,expectedMonthlyBudgetSatang:900_000}));

      await primeCache(meterPrisma);
      assert.equal(configReads, 2, 'admission must read current settings');
    }
  });
});

function makeOcrPrisma(input: {
  existing?: { ocrEnabled: boolean; ocrMonthlyLimit: number | null; ocrConfigVersion?: number; receiptQuotaEnforced?: boolean | null };
  status?: string;
} = {}) {
  let saved = input.existing ? { ...input.existing, ocrConfigVersion: input.existing.ocrConfigVersion ?? 0 } : undefined;
  let ocrUpsertArgs: any = null;
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
      upsert: async (args: any) => {
        const { create, update } = args;
        ocrUpsertArgs = args;
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
    upsertArgs: () => ocrUpsertArgs,
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
  reason:'ปรับตามคำขอทดสอบ',
  enabled: true,
  monthlyLimit: 100 as number | null,
  expectedVersion: 0,
  requestingAdminUserId: 'admin-1',
  requestId: 'req-1',
  ...overrides,
});

describe('SetPartnerOcrConfigUseCase', () => {
  it('requires a nonblank reason before either mutation or replay', async () => {
    const state=makeOcrPrisma();
    for(const reason of ['', ' ', 'x'.repeat(501)])await assert.rejects(new SetPartnerOcrConfigUseCase(state.prisma).execute({...ocrCommand(),reason}),UnprocessableEntityException);
    assert.equal(state.upserts(),0);assert.equal(state.audits.length,0);
  });
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
      source: 'ADMIN_ADJUSTMENT', entryPoint: 'SYSTEM_PARTNER_ADMIN', reason:'ปรับตามคำขอทดสอบ',
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
          companyId, enabled: false, monthlyLimit: null, expectedVersion: 0, reason:'ปรับตามคำขอทดสอบ',
          requestingAdminUserId: adminIds[0]!, requestId: `ocr-cas-a-${runId}`,
        },
        {
          companyId, enabled: true, monthlyLimit: 25, expectedVersion: 0, reason:'ปรับตามคำขอทดสอบ',
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
      const aiCommands=clients.map((_,index)=>({companyId,reason:'ปรับตามคำขอทดสอบ',expectedMonthlyBudgetSatang:null as number|null,
        monthlyBudgetSatang:[1234,2345][index]!,requestingAdminUserId:adminIds[index]!,requestId:`ai-audit-${index}-${runId}`}));
      const aiResults=await Promise.allSettled(clients.map((client,index)=>new SetPartnerAiModelUseCase({client} as any,makeConfig()).execute(aiCommands[index]!)));
      assert.equal(aiResults.filter(r=>r.status==='fulfilled').length,1);
      const loser=aiResults.findIndex(r=>r.status==='rejected');
      assert.ok((aiResults[loser] as PromiseRejectedResult).reason instanceof ConflictException);
      const winningBudget=(await clients[0]!.companyAiConfiguration.findUniqueOrThrow({where:{companyId}})).monthlyBudgetSatang;
      await new SetPartnerAiModelUseCase({client:clients[loser]} as any,makeConfig()).execute({...aiCommands[loser]!,expectedMonthlyBudgetSatang:winningBudget});
      // Lost-response replay is a no-op after a successful write; a changed current value is protected.
      await new SetPartnerAiModelUseCase({client:clients[loser]} as any,makeConfig()).execute({...aiCommands[loser]!,expectedMonthlyBudgetSatang:winningBudget});
      await assert.rejects(new SetPartnerAiModelUseCase({client:clients[0]} as any,makeConfig()).execute(aiCommands[1-loser]!),ConflictException);
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

  it('never writes the split-policy columns: the OCR control shares the row but not the budget (F-05)', async () => {
    const state = makeOcrPrisma({ existing: { ocrEnabled: true, ocrMonthlyLimit: null, ocrConfigVersion: 3 } });
    await new SetPartnerOcrConfigUseCase(state.prisma).execute(ocrCommand({ enabled: false, monthlyLimit: 25, expectedVersion: 3 }));
    const { create, update } = state.upsertArgs();
    for (const payload of [create, update]) {
      for (const column of ['budgetMode', 'chatMonthlyBudgetSatang', 'ocrMonthlyBudgetSatang', 'budgetConfigVersion', 'pendingBudgetPolicy']) {
        assert.equal(column in payload, false, `${column} must be left to the governed budget writer`);
      }
    }
    // On a brand-new row the schema defaults apply, which is SHARED with nothing allocated.
    assert.equal(create.ocrConfigVersion, 1);
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

// ── Split CHAT/OCR budget policy writer (spec §12.4/§12.5, ADR 0013 §8, review F-05/F-06/F-07) ──

/** Mid-month instants, so "current" and "next" are unambiguous without mocking Date globally. */
const SEPT = new Date('2026-09-15T03:00:00.000Z');
const OCT = new Date('2026-10-15T03:00:00.000Z');
const THIS_MONTH = bangkokMonthKey(SEPT);   // 2026-09
const NEXT_MONTH = nextBangkokMonthKey(SEPT); // 2026-10

const split = (over: Partial<PartnerAiBudgetPolicyInput> = {}): PartnerAiBudgetPolicyInput => ({
  mode: 'SPLIT', chatMonthlyBudgetSatang: 30, ocrMonthlyBudgetSatang: 70, effectiveMonthKey: NEXT_MONTH, ...over,
});

const BASE_ROW = {
  // A company that can be put on SPLIT at all has its own approved model: the hold is priced from
  // that model, so Phase E1b refuses a SPLIT result while `modelId` is null (own tests below).
  modelId: APPROVED as string | null, monthlyBudgetSatang: null as number | null, updatedAt: new Date('2026-09-01T00:00:00.000Z'),
  budgetMode: 'SHARED', chatMonthlyBudgetSatang: null as number | null, ocrMonthlyBudgetSatang: null as number | null,
  budgetConfigVersion: 0, pendingBudgetPolicy: null as unknown,
};

/** Applies a Prisma `data` payload the way PostgreSQL would: increments increment, DbNull nulls. */
function applyData(row: any, data: Record<string, any>) {
  const next = { ...row };
  for (const [field, value] of Object.entries(data)) {
    if (value && typeof value === 'object' && 'increment' in value) next[field] = (next[field] ?? 0) + value.increment;
    else if (value === Prisma.DbNull) next[field] = null;
    else next[field] = value;
  }
  return next;
}

function makePolicyPrisma(input: {
  row?: Partial<typeof BASE_ROW> | null;
  status?: string;
  platform?: { monthlyBudgetSatang: number; ceilingSatang: number } | null;
  monthUsage?: { costSatang: number; callCount: number } | null;
  bucketSpend?: Array<{ budgetBucket: string | null; _sum: { costSatang: number | null } }>;
} = {}) {
  let row: any = input.row === undefined || input.row === null ? null : { ...BASE_ROW, ...input.row };
  const audits: any[] = [];
  const bucketQueries: any[] = [];
  const lockOrder: string[] = [];
  const tx = {
    $executeRaw: async (_sql: TemplateStringsArray, key: string) => { lockOrder.push(key); },
    $queryRaw: async (_sql: TemplateStringsArray, id: string) => { lockOrder.push(`company:${id}`); return []; },
    company: { findUnique: async () => ({ id: 'co-1', status: input.status ?? 'ACTIVE' }) },
    platformAiBudgetConfig: { findUnique: async () => input.platform ?? null },
    companyAiMonthlyUsage: { findUnique: async () => input.monthUsage ?? null },
    aiUsageEvent: { groupBy: async (args: any) => { bucketQueries.push(args); return input.bucketSpend ?? []; } },
    companyAiConfiguration: {
      findUnique: async () => row,
      update: async ({ data }: any) => { row = applyData(row, data); return row; },
      upsert: async ({ create, update }: any) => {
        row = row ? applyData(row, update) : applyData({ ...BASE_ROW }, create);
        return { companyId: 'co-1', ...row };
      },
    },
    auditLog: { create: async ({ data }: any) => { audits.push(data); return data; } },
  };
  return {
    audits, lockOrder, bucketQueries,
    row: () => row,
    prisma: {
      client: {
        company: { findUnique: async () => ({ id: 'co-1', status: input.status ?? 'ACTIVE' }) },
        $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(tx),
      },
    } as any,
  };
}

const policyCmd = (fields: Partial<SetPartnerAiModelCommand> = {}): SetPartnerAiModelCommand => ({
  companyId: 'co-1', reason: 'ปรับตามคำขอทดสอบ', requestingAdminUserId: 'admin-1', requestId: 'req-1',
  now: SEPT, expectedBudgetRevision: `0:${THIS_MONTH}:ACTIVE`, ...fields,
});

const run = (state: ReturnType<typeof makePolicyPrisma>, fields: Partial<SetPartnerAiModelCommand> = {}) =>
  new SetPartnerAiModelUseCase(state.prisma, makeConfig()).execute(policyCmd(fields));

const rejectsWith = async (promise: Promise<unknown>, needle: string) => assert.rejects(promise, (err: unknown) => {
  assert.ok(err instanceof UnprocessableEntityException, `expected 422 for ${needle}, got ${err}`);
  assert.match(JSON.stringify((err as UnprocessableEntityException).getResponse()), new RegExp(needle));
  return true;
});

describe('SetPartnerAiModelUseCase — split budget policy', () => {
  beforeEach(() => __resetCompanyAiBudgetCache());

  it('owner 2026-09-29: SPLIT is savable for this month or next with no activation switch at all', async () => {
    for (const effectiveMonthKey of [THIS_MONTH, NEXT_MONTH]) {
      const state = makePolicyPrisma({ row: {} });
      const saved = await run(state, { budgetPolicy: split({ effectiveMonthKey }) });
      assert.equal(state.audits.length, 1, effectiveMonthKey);
      assert.equal('splitActivationEnabled' in saved.budgetPolicy, false, 'the retired flag is not on the wire');
    }
  });

  it('absent = preserve: a model-only write never touches the policy or bumps its version', async () => {
    const state = makePolicyPrisma({ row: { budgetMode: 'SPLIT', chatMonthlyBudgetSatang: 30, ocrMonthlyBudgetSatang: 70, budgetConfigVersion: 4, monthlyBudgetSatang: 100 } });
    const saved = await new SetPartnerAiModelUseCase(state.prisma, makeConfig()).execute({
      ...policyCmd(), modelId: APPROVED, expectedModelId: null, expectedBudgetRevision: undefined,
    });
    assert.equal(state.row().budgetConfigVersion, 4);
    assert.equal(state.row().budgetMode, 'SPLIT');
    assert.deepEqual([saved.budgetPolicy.mode, saved.budgetPolicy.revision], ['SPLIT', `4:${THIS_MONTH}:ACTIVE`]);
  });

  it('requires the CAS fence with any policy write, and refuses a stale one with 409', async () => {
    const state = makePolicyPrisma({ row: { budgetConfigVersion: 2 } });
    await rejectsWith(new SetPartnerAiModelUseCase(state.prisma, makeConfig())
      .execute({ ...policyCmd(), budgetPolicy: split(), expectedBudgetRevision: undefined }), 'partner_ai_budget_revision_required');
    await assert.rejects(run(state, { budgetPolicy: split(), expectedBudgetRevision: `1:${THIS_MONTH}:ACTIVE` }),
      (err: unknown) => err instanceof ConflictException && (err.getResponse() as any).code === 'partner_ai_budget_revision_conflict');
    // R-07: a page rendered LAST month carries last month's key, so it conflicts on its own.
    await assert.rejects(run(state, { budgetPolicy: split(), expectedBudgetRevision: `2:2026-08:ACTIVE` }), ConflictException);
    assert.deepEqual(state.audits, []);
  });

  it('schedules next month without touching the active policy, and the resolver then reports it as pending', async () => {
    const state = makePolicyPrisma({ row: { monthlyBudgetSatang: 100 } });
    const saved = await run(state, { budgetPolicy: split() });
    assert.equal(state.row().budgetMode, 'SHARED', 'the current month keeps the shared total');
    assert.deepEqual(state.row().pendingBudgetPolicy, split());
    assert.equal(state.row().budgetConfigVersion, 1);
    assert.deepEqual(
      { mode: saved.budgetPolicy.mode, source: saved.budgetPolicy.source, pending: saved.budgetPolicy.pending, revision: saved.budgetPolicy.revision },
      { mode: 'SHARED', source: 'ACTIVE', pending: split(), revision: `1:${THIS_MONTH}:ACTIVE` },
    );
  });

  it('exact replay of the scheduled policy is a no-op: no second audit row, no version bump', async () => {
    const state = makePolicyPrisma({ row: { monthlyBudgetSatang: 100, pendingBudgetPolicy: split(), budgetConfigVersion: 1 } });
    const saved = await run(state, { budgetPolicy: split(), expectedBudgetRevision: `1:${THIS_MONTH}:ACTIVE` });
    assert.deepEqual(state.audits, []);
    assert.equal(state.row().budgetConfigVersion, 1);
    assert.deepEqual(saved.budgetPolicy.pending, split());
  });

  it('activates SPLIT in the CURRENT month only while the month carries no metered usage (E-08)', async () => {
    const clean = makePolicyPrisma({ row: { monthlyBudgetSatang: 100 }, monthUsage: { costSatang: 0, callCount: 0 } });
    await run(clean, { budgetPolicy: split({ effectiveMonthKey: THIS_MONTH }) });
    assert.equal(clean.row().budgetMode, 'SPLIT');

    for (const monthUsage of [{ costSatang: 5567, callCount: 3 }, { costSatang: 0, callCount: 2 }]) {
      const spent = makePolicyPrisma({ row: { monthlyBudgetSatang: 100 }, monthUsage });
      await rejectsWith(run(spent, { budgetPolicy: split({ effectiveMonthKey: THIS_MONTH }) }), 'partner_ai_budget_split_requires_next_month');
      assert.equal(spent.row().budgetMode, 'SHARED', 'legacy spend is never guessed into buckets');
    }
  });

  it('refuses C + O above the live effective total, against the override and against the inherited default', async () => {
    const override = makePolicyPrisma({ row: { monthlyBudgetSatang: 99 } });
    await rejectsWith(run(override, { budgetPolicy: split() }), 'partner_ai_budget_split_exceeds_total');
    const inherited = makePolicyPrisma({ row: {}, platform: { monthlyBudgetSatang: 99, ceilingSatang: CEILING } });
    await rejectsWith(run(inherited, { budgetPolicy: split() }), 'partner_ai_budget_split_exceeds_total');
    // Exactly T fits.
    const exact = makePolicyPrisma({ row: {}, platform: { monthlyBudgetSatang: 100, ceilingSatang: CEILING } });
    await run(exact, { budgetPolicy: split() });
    assert.deepEqual(exact.row().pendingBudgetPolicy, split());
  });

  it('refuses a total change that would leave an ACTIVE or PENDING allocation above the new total (F-05)', async () => {
    const active = makePolicyPrisma({ row: { monthlyBudgetSatang: 100, budgetMode: 'SPLIT', chatMonthlyBudgetSatang: 30, ocrMonthlyBudgetSatang: 70 } });
    await rejectsWith(new SetPartnerAiModelUseCase(active.prisma, makeConfig()).execute({
      ...policyCmd(), monthlyBudgetSatang: 99, expectedMonthlyBudgetSatang: 100, expectedBudgetRevision: undefined,
    }), 'partner_ai_budget_total_below_split_allocation');
    assert.equal(active.row().monthlyBudgetSatang, 100);

    const scheduled = makePolicyPrisma({ row: { monthlyBudgetSatang: 100, pendingBudgetPolicy: split() } });
    await rejectsWith(new SetPartnerAiModelUseCase(scheduled.prisma, makeConfig()).execute({
      ...policyCmd(), monthlyBudgetSatang: 99, expectedMonthlyBudgetSatang: 100, expectedBudgetRevision: undefined,
    }), 'partner_ai_budget_total_below_split_allocation');

    // Clearing the override is validated against the platform default the company would inherit.
    const cleared = makePolicyPrisma({
      row: { monthlyBudgetSatang: 100, budgetMode: 'SPLIT', chatMonthlyBudgetSatang: 30, ocrMonthlyBudgetSatang: 70 },
      platform: { monthlyBudgetSatang: 50, ceilingSatang: CEILING },
    });
    await rejectsWith(new SetPartnerAiModelUseCase(cleared.prisma, makeConfig()).execute({
      ...policyCmd(), monthlyBudgetSatang: null, expectedMonthlyBudgetSatang: 100, expectedBudgetRevision: undefined,
    }), 'partner_ai_budget_total_below_split_allocation');
  });

  it('refuses a mode, cap or month the contract does not allow, before taking any lock', async () => {
    for (const [budgetPolicy, needle] of [
      [{ ...split(), mode: 'HALF' }, 'partner_ai_budget_policy_invalid'],
      [split({ chatMonthlyBudgetSatang: -1 }), 'partner_ai_budget_policy_invalid'],
      [split({ ocrMonthlyBudgetSatang: 1.5 }), 'partner_ai_budget_policy_invalid'],
      [split({ effectiveMonthKey: '2026-13' }), 'partner_ai_budget_policy_invalid'],
      [split({ effectiveMonthKey: '2026-08' }), 'partner_ai_budget_effective_month_invalid'],
      [split({ effectiveMonthKey: '2026-11' }), 'partner_ai_budget_effective_month_invalid'],
      [{ mode: 'SPLIT', chatMonthlyBudgetSatang: null, ocrMonthlyBudgetSatang: 70, effectiveMonthKey: NEXT_MONTH }, 'partner_ai_budget_split_caps_required'],
    ] as const) {
      const state = makePolicyPrisma({ row: {} });
      await rejectsWith(run(state, { budgetPolicy: budgetPolicy as PartnerAiBudgetPolicyInput }), needle);
      assert.deepEqual(state.lockOrder, [], 'a malformed body never reaches the locks');
    }
  });

  it('F-06: once the month has turned the pending policy is MATERIALISED, and cancelling it cannot fall back to SHARED', async () => {
    const state = makePolicyPrisma({ row: { monthlyBudgetSatang: 100, pendingBudgetPolicy: split(), budgetConfigVersion: 1 } });
    // The operator's page was rendered after midnight: source PENDING_ACTIVATED, version still 1.
    const saved = await run(state, { budgetPolicy: null, now: OCT, expectedBudgetRevision: `1:${NEXT_MONTH}:PENDING_ACTIVATED` });
    assert.equal(state.row().budgetMode, 'SPLIT', 'the activated policy is now the ACTIVE one');
    assert.deepEqual([state.row().chatMonthlyBudgetSatang, state.row().ocrMonthlyBudgetSatang], [30, 70]);
    assert.equal(state.row().pendingBudgetPolicy, null);
    assert.equal(saved.budgetPolicy.mode, 'SPLIT');
    assert.equal(state.audits.length, 1, 'the activation is audited; the cancel found nothing left to cancel');
    assert.equal(state.audits[0].metadataJson.budgetPolicyEvent, 'PENDING_ACTIVATED');
    assert.deepEqual(
      [state.audits[0].metadataJson.fromBudgetMode, state.audits[0].metadataJson.toBudgetMode], ['SHARED', 'SPLIT']);
  });

  it('cancels a FUTURE pending policy and leaves the active one exactly as it was', async () => {
    const state = makePolicyPrisma({ row: { monthlyBudgetSatang: 100, budgetMode: 'SPLIT', chatMonthlyBudgetSatang: 30, ocrMonthlyBudgetSatang: 70,
      pendingBudgetPolicy: { mode: 'SHARED', chatMonthlyBudgetSatang: null, ocrMonthlyBudgetSatang: null, effectiveMonthKey: NEXT_MONTH }, budgetConfigVersion: 3 } });
    const saved = await run(state, { budgetPolicy: null, expectedBudgetRevision: `3:${THIS_MONTH}:ACTIVE` });
    assert.equal(state.row().pendingBudgetPolicy, null);
    assert.equal(state.row().budgetMode, 'SPLIT');
    assert.equal(state.row().budgetConfigVersion, 4);
    assert.equal(saved.budgetPolicy.pending, null);
    assert.equal(state.audits.length, 1);
    assert.equal(state.audits[0].metadataJson.fromPendingBudgetPolicy, `SHARED:null:null:${NEXT_MONTH}`);
    assert.equal(state.audits[0].metadataJson.toPendingBudgetPolicy, null);
  });

  it('cancelling when nothing is pending is a no-op, not a version bump', async () => {
    const state = makePolicyPrisma({ row: { budgetConfigVersion: 2 } });
    await run(state, { budgetPolicy: null, expectedBudgetRevision: `2:${THIS_MONTH}:ACTIVE` });
    assert.deepEqual(state.audits, []);
    assert.equal(state.row().budgetConfigVersion, 2);
  });

  it('SPLIT → SHARED is next month only, and a cap may not drop below what that bucket already spent', async () => {
    const splitRow = { monthlyBudgetSatang: 100, budgetMode: 'SPLIT', chatMonthlyBudgetSatang: 30, ocrMonthlyBudgetSatang: 70, budgetConfigVersion: 5 };
    const revision = `5:${THIS_MONTH}:ACTIVE`;
    const back = makePolicyPrisma({ row: splitRow });
    await rejectsWith(run(back, { budgetPolicy: { mode: 'SHARED', chatMonthlyBudgetSatang: null, ocrMonthlyBudgetSatang: null, effectiveMonthKey: THIS_MONTH }, expectedBudgetRevision: revision }),
      'partner_ai_budget_mode_change_next_month_only');
    // …but it may be SCHEDULED, which is the supported way back.
    const scheduled = makePolicyPrisma({ row: splitRow });
    await run(scheduled, { budgetPolicy: { mode: 'SHARED', chatMonthlyBudgetSatang: null, ocrMonthlyBudgetSatang: null, effectiveMonthKey: NEXT_MONTH }, expectedBudgetRevision: revision });
    assert.equal(scheduled.row().budgetMode, 'SPLIT');
    assert.equal((scheduled.row().pendingBudgetPolicy as any).mode, 'SHARED');

    const spend = [{ budgetBucket: 'CHAT', _sum: { costSatang: 25 } }, { budgetBucket: null, _sum: { costSatang: 40 } }];
    const lowered = makePolicyPrisma({ row: splitRow, bucketSpend: spend });
    await rejectsWith(run(lowered, { budgetPolicy: split({ chatMonthlyBudgetSatang: 24, ocrMonthlyBudgetSatang: 70, effectiveMonthKey: THIS_MONTH }), expectedBudgetRevision: revision }),
      'partner_ai_budget_cap_below_bucket_spend');
    // A same-mode increase — and a decrease that still covers the bucket's spend — go through now.
    const raised = makePolicyPrisma({ row: splitRow, bucketSpend: spend });
    await run(raised, { budgetPolicy: split({ chatMonthlyBudgetSatang: 25, ocrMonthlyBudgetSatang: 75, effectiveMonthKey: THIS_MONTH }), expectedBudgetRevision: revision });
    assert.deepEqual([raised.row().chatMonthlyBudgetSatang, raised.row().ocrMonthlyBudgetSatang], [25, 75]);
    assert.deepEqual(raised.bucketQueries[0].where.OR, [{ usageBasis: null }, { usageBasis: { not: 'COMPANY_ABSORBED' } }],
      'company-only cost must never prevent a customer cap change');
  });

  it('writes the whole policy before/after into the CRITICAL audit row, and the history renders it', async () => {
    const state = makePolicyPrisma({ row: { monthlyBudgetSatang: 100, budgetConfigVersion: 1 } });
    await run(state, { budgetPolicy: split({ effectiveMonthKey: THIS_MONTH }), expectedBudgetRevision: `1:${THIS_MONTH}:ACTIVE` });
    const audit = state.audits[0];
    assert.equal(audit.riskLevel, 'CRITICAL');
    assert.equal(audit.action, 'system.partner_ai_model.update');
    assert.deepEqual({
      fromBudgetMode: audit.metadataJson.fromBudgetMode, toBudgetMode: audit.metadataJson.toBudgetMode,
      fromChat: audit.metadataJson.fromChatMonthlyBudgetSatang, toChat: audit.metadataJson.toChatMonthlyBudgetSatang,
      fromOcr: audit.metadataJson.fromOcrMonthlyBudgetSatang, toOcr: audit.metadataJson.toOcrMonthlyBudgetSatang,
      fromVersion: audit.metadataJson.fromBudgetConfigVersion, toVersion: audit.metadataJson.toBudgetConfigVersion,
    }, { fromBudgetMode: 'SHARED', toBudgetMode: 'SPLIT', fromChat: null, toChat: 30, fromOcr: null, toOcr: 70, fromVersion: 1, toVersion: 2 });
    // The allowlist must carry these through to the operator-visible history (R-08).
    assert.deepEqual(aiAdjustmentDetails(audit.metadataJson).changes, [
      { field: 'budgetMode', before: 'SHARED', after: 'SPLIT' },
      { field: 'chatMonthlyBudgetSatang', before: null, after: 30 },
      { field: 'ocrMonthlyBudgetSatang', before: null, after: 70 },
      { field: 'budgetConfigVersion', before: 1, after: 2 },
    ]);
  });

  it('refuses a SPLIT result while the company has no model of its own — at SAVE time, not silently', async () => {
    // Admission prices a hold from the company's OWN model, so a SPLIT company inheriting the
    // platform default would refuse every AI call with AI_BUDGET_UNAVAILABLE. The operator has to
    // find that out here, not from a shop that went quiet after a successful-looking save.
    const noModel = makePolicyPrisma({ row: { modelId: null, monthlyBudgetSatang: 100 } });
    await rejectsWith(run(noModel, { budgetPolicy: split() }), 'partner_ai_budget_split_requires_model');
    assert.equal(noModel.row().pendingBudgetPolicy, null, 'nothing was written');

    // ...and the same write that picks a model is accepted, so the operator is never trapped.
    const fixed = makePolicyPrisma({ row: { modelId: null, monthlyBudgetSatang: 100 } });
    await run(fixed, { budgetPolicy: split(), modelId: APPROVED, expectedModelId: null });
    assert.equal(fixed.row().modelId, APPROVED);
    assert.ok(fixed.row().pendingBudgetPolicy, 'the pending policy was saved alongside the model');
  });

  it('lets a SHARED company keep inheriting the platform default model', async () => {
    const shared = makePolicyPrisma({ row: { modelId: null, monthlyBudgetSatang: 100 } });
    const saved = await run(shared, { monthlyBudgetSatang: 200, expectedMonthlyBudgetSatang: 100 });
    assert.equal(saved.modelId, null, 'the model gate is a SPLIT rule only');
  });

  it('admin tab rework: sets a shop chat credit this month through SHARED, even with spend, and a TOTAL edit never moves it', async () => {
    const state = makePolicyPrisma({ row: { monthlyBudgetSatang: 8_000, chatMonthlyBudgetSatang: 8_000, modelId: null },
      monthUsage: { costSatang: 5_000, callCount: 9 } });
    const saved = await run(state, { budgetPolicy: { mode: 'SHARED', chatMonthlyBudgetSatang: 15_000, ocrMonthlyBudgetSatang: null, effectiveMonthKey: THIS_MONTH } });
    assert.deepEqual([state.row().budgetMode, state.row().chatMonthlyBudgetSatang, state.row().monthlyBudgetSatang], ['SHARED', 15_000, 8_000]);
    assert.deepEqual([saved.budgetPolicy.chatCapSatang, saved.budgetPolicy.chatSource], [15_000, 'ADMIN']);
    assert.equal(state.audits.at(-1).metadataJson.fromChatMonthlyBudgetSatang, 8_000);
    assert.equal(state.audits.at(-1).metadataJson.toChatMonthlyBudgetSatang, 15_000);
    // The safety ceiling is its own field: raising it leaves the chat credit exactly where it was.
    await run(state, { monthlyBudgetSatang: 300_000, expectedMonthlyBudgetSatang: 8_000, expectedBudgetRevision: undefined });
    assert.deepEqual([state.row().monthlyBudgetSatang, state.row().chatMonthlyBudgetSatang], [300_000, 15_000]);
    // Clearing hands the shop back to the default (or its sales deal).
    const cleared = await run(state, { budgetPolicy: { mode: 'SHARED', chatMonthlyBudgetSatang: null, ocrMonthlyBudgetSatang: null, effectiveMonthKey: THIS_MONTH },
      expectedBudgetRevision: `1:${THIS_MONTH}:ACTIVE` });
    assert.deepEqual([cleared.budgetPolicy.chatCapSatang, cleared.budgetPolicy.chatSource], [5_000, 'DEFAULT']);
  });

  it('keeps the canonical lock order and refuses a locked company before any policy write', async () => {
    const state = makePolicyPrisma({ row: { monthlyBudgetSatang: 100 } });
    await run(state, { budgetPolicy: split() });
    // Phase E1b appends the company-month budget lock LAST — the same lock `reserveAiBudgetStep`
    // and `settleAiBudgetStep` take, so a cap change and a live admission serialize (spec §12.7).
    assert.deepEqual(state.lockOrder, [
      'partner-ocr-config:co-1', 'company:co-1', 'platform-ai-budget', `ai-budget:co-1:${THIS_MONTH}`,
    ]);
    for (const status of ['DISABLED', 'ARCHIVED']) {
      const locked = makePolicyPrisma({ row: { monthlyBudgetSatang: 100 }, status });
      await assert.rejects(run(locked, { budgetPolicy: split() }), UnprocessableEntityException);
      assert.equal(locked.row().pendingBudgetPolicy, null);
    }
  });
});
