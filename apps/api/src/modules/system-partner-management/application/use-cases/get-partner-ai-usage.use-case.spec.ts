import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../../../generated/prisma/client';
import { GetPartnerAiUsageUseCase } from './get-partner-ai-usage.use-case';
import {
  __resetCompanyAiBudgetCache,
  bangkokMonthKey,
  previousBangkokMonthKey,
} from '../../../line-ai/application/company-ai-usage-meter';

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
  companyExists?: boolean;
  ocrConfig?: { enabled: boolean; monthlyLimit: number | null; version?: number; updatedAt?: Date };
  ocrMonths?: Array<{ monthKey: string; usedCount: number }>;
  ocrSources?: Array<{ monthKey: string; sourceRoute: string; _count: { _all: number } }>;
  uploads?: [number, number];
} = {}) {
  const calls: { monthWhere?: any; groupBy?: any; ocrGroupBy?: any; uploadWhere?: any[]; transactionOptions?: any } = {};
  let uploadIndex = 0;
  const client: any = {
      company: {
        findUnique: async () => opts.companyExists === false ? null : { id: 'co-1' },
      },
      companyAiMonthlyUsage: {
        findMany: async (args: any) => { calls.monthWhere = args.where; return opts.months ?? []; },
      },
      companyAiConfiguration: {
        findUnique: async () => (opts.overrideSatang === undefined && !opts.ocrConfig ? null : {
          monthlyBudgetSatang: opts.overrideSatang ?? null,
          ocrEnabled: opts.ocrConfig?.enabled ?? true,
          ocrMonthlyLimit: opts.ocrConfig?.monthlyLimit ?? null,
          ocrConfigVersion: opts.ocrConfig?.version ?? 0,
          updatedAt: opts.ocrConfig?.updatedAt ?? new Date('2026-08-27T00:00:00.000Z'),
        }),
      },
      aiUsageEvent: {
        groupBy: async (args: any) => { calls.groupBy = args; return opts.tags ?? []; },
      },
      companyOcrMonthlyUsage: {
        findMany: async () => opts.ocrMonths ?? [],
      },
      companyOcrUsageEvent: {
        groupBy: async (args: any) => { calls.ocrGroupBy = args; return opts.ocrSources ?? []; },
      },
      attachmentObject: {
        count: async (args: any) => {
          (calls.uploadWhere ??= []).push(args.where);
          return opts.uploads?.[uploadIndex++] ?? 0;
        },
      },
  };
  client.$transaction = async (fn: (tx: typeof client) => Promise<unknown>, options: unknown) => {
    calls.transactionOptions = options;
    return fn(client);
  };
  return { calls, client } as any;
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

  it('reports OCR configuration, logical reads by seam, and uploaded receipt documents separately', async () => {
    const prisma = makePrisma({
      ocrConfig: { enabled: false, monthlyLimit: 40, version: 6 },
      ocrMonths: [{ monthKey: CURRENT, usedCount: 12 }, { monthKey: PREVIOUS, usedCount: 7 }],
      ocrSources: [
        { monthKey: CURRENT, sourceRoute: 'receipt-ocr-web', _count: { _all: 5 } },
        { monthKey: CURRENT, sourceRoute: 'receipt-ocr-line', _count: { _all: 4 } },
        { monthKey: CURRENT, sourceRoute: 'bank-statement-extract', _count: { _all: 3 } },
        { monthKey: PREVIOUS, sourceRoute: 'receipt-ocr-web', _count: { _all: 7 } },
      ],
      uploads: [31, 22],
    });
    const result = await new GetPartnerAiUsageUseCase(prisma, makeConfig()).execute('co-1');

    assert.deepEqual(result.ocr.config, {
      enabled: false,
      monthlyLimit: 40,
      version: 6,
      updatedAt: '2026-08-27T00:00:00.000Z',
    });
    assert.equal(result.ocr.current.usedCount, 12);
    assert.equal(result.ocr.current.uploadedReceiptDocumentCount, 31);
    assert.deepEqual(result.ocr.current.sourceCounts.map((item) => item.reads), [5, 4, 3]);
    assert.equal(result.ocr.previous.usedCount, 7);
    assert.equal(result.ocr.previous.uploadedReceiptDocumentCount, 22);
    assert.deepEqual(prisma.calls.ocrGroupBy.where, {
      companyId: 'co-1', monthKey: { in: [CURRENT, PREVIOUS] },
    });
    assert.deepEqual(prisma.calls.transactionOptions, {
      isolationLevel: 'RepeatableRead',
      maxWait: 5_000,
      timeout: 15_000,
    });
  });

  it('counts only active receipt-purpose expense attachments in each Bangkok upload month', async () => {
    const prisma = makePrisma();
    await new GetPartnerAiUsageUseCase(prisma, makeConfig()).execute('co-1');

    assert.equal(prisma.calls.uploadWhere.length, 2);
    for (const where of prisma.calls.uploadWhere) {
      assert.equal(where.companyId, 'co-1');
      assert.equal(where.status, 'ACTIVE');
      assert.deepEqual(where.links.some, {
        companyId: 'co-1',
        targetType: 'expense.record',
        purpose: { in: ['expense.receipt.primary', 'expense.receipt.supporting'] },
      });
      assert.ok(where.uploadedAt.gte instanceof Date);
      assert.ok(where.uploadedAt.lt instanceof Date);
      assert.ok(where.uploadedAt.lt > where.uploadedAt.gte);
    }
  });

  it('real PostgreSQL: keeps aggregate and source counts on one snapshot during an interleaved admission', async (t) => {
    const databaseUrl = process.env.DATABASE_URL?.trim();
    if (!databaseUrl) {
      if (process.env.OCR_REQUIRE_POSTGRES === 'true') throw new Error('OCR PostgreSQL test database is required');
      return t.skip('DATABASE_URL is not set');
    }

    const reader = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
    const writer = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
    let companyId = '';
    try {
      await Promise.all([reader.$queryRaw`SELECT 1`, writer.$queryRaw`SELECT 1`]);
      companyId = (await reader.company.create({
        data: { name: `ocr-usage-snapshot-${process.pid}-${randomUUID()}`, status: 'ACTIVE' },
        select: { id: true },
      })).id;
      await reader.companyOcrMonthlyUsage.create({ data: { companyId, monthKey: CURRENT, usedCount: 1 } });
      await reader.companyOcrUsageEvent.create({
        data: { companyId, monthKey: CURRENT, sourceRoute: 'receipt-ocr-web', requestId: `before-${randomUUID()}` },
      });

      let interleaved = false;
      const client = new Proxy(reader, {
        get(target, property, receiver) {
          if (property !== '$transaction') {
            const value = Reflect.get(target, property, receiver);
            return typeof value === 'function' ? value.bind(target) : value;
          }
          return async (fn: (tx: any) => Promise<unknown>, options: unknown) => target.$transaction(async (tx) => {
            const usageDelegate = new Proxy(tx.companyOcrMonthlyUsage, {
              get(delegate, delegateProperty, delegateReceiver) {
                if (delegateProperty !== 'findMany') {
                  const value = Reflect.get(delegate, delegateProperty, delegateReceiver);
                  return typeof value === 'function' ? value.bind(delegate) : value;
                }
                return async (args: any) => {
                  const rows = await tx.companyOcrMonthlyUsage.findMany(args);
                  if (!interleaved) {
                    interleaved = true;
                    await writer.$transaction(async (writeTx) => {
                      await writeTx.companyOcrUsageEvent.create({
                        data: { companyId, monthKey: CURRENT, sourceRoute: 'receipt-ocr-line', requestId: `during-${randomUUID()}` },
                      });
                      await writeTx.companyOcrMonthlyUsage.update({
                        where: { companyId_monthKey: { companyId, monthKey: CURRENT } },
                        data: { usedCount: { increment: 1 } },
                      });
                    });
                  }
                  return rows;
                };
              },
            });
            const hookedTx = new Proxy(tx, {
              get(targetTx, txProperty, txReceiver) {
                if (txProperty === 'companyOcrMonthlyUsage') return usageDelegate;
                const value = Reflect.get(targetTx, txProperty, txReceiver);
                return typeof value === 'function' ? value.bind(targetTx) : value;
              },
            });
            return fn(hookedTx);
          }, options as any);
        },
      });

      __resetCompanyAiBudgetCache();
      const result = await new GetPartnerAiUsageUseCase(
        { client } as any,
        makeConfig(),
      ).execute(companyId);
      assert.equal(interleaved, true);
      assert.equal(result.ocr.current.usedCount, 1);
      assert.equal(result.ocr.current.sourceCounts.find((item) => item.sourceRoute === 'receipt-ocr-web')?.reads, 1);
      assert.equal(result.ocr.current.sourceCounts.find((item) => item.sourceRoute === 'receipt-ocr-line')?.reads, 0);
      assert.equal((await writer.companyOcrMonthlyUsage.findUniqueOrThrow({
        where: { companyId_monthKey: { companyId, monthKey: CURRENT } },
        select: { usedCount: true },
      })).usedCount, 2);
      assert.equal(await writer.companyOcrUsageEvent.count({ where: { companyId, monthKey: CURRENT } }), 2);
    } finally {
      if (companyId) await reader.company.deleteMany({ where: { id: companyId } });
      await Promise.all([reader.$disconnect().catch(() => undefined), writer.$disconnect().catch(() => undefined)]);
    }
  });

  it('rejects an unknown company instead of returning a synthetic meter', async () => {
    const prisma = makePrisma({ companyExists: false });
    await assert.rejects(
      () => new GetPartnerAiUsageUseCase(prisma, makeConfig()).execute('missing'),
      { name: 'NotFoundException' },
    );
  });

  it('previousBangkokMonthKey rolls the year back at January', () => {
    // 2026-01-01 07:00 Bangkok = 2026-01-01T00:00Z
    assert.equal(previousBangkokMonthKey(new Date('2026-01-01T00:00:00.000Z')), '2025-12');
    assert.equal(previousBangkokMonthKey(new Date('2026-03-15T00:00:00.000Z')), '2026-02');
    // Bangkok is +7: 23:30 UTC on the last day of July is already August there.
    assert.equal(previousBangkokMonthKey(new Date('2026-07-31T23:30:00.000Z')), '2026-07');
  });
});
