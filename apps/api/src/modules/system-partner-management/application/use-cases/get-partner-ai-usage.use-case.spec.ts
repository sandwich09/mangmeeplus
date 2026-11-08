import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../../../generated/prisma/client';
import { pgSpecUnreachableReason } from '../../../../common/database/pg-spec-guard';
import { GetPartnerAiUsageUseCase, partnerReceiptImages } from './get-partner-ai-usage.use-case';
import {
  __resetCompanyAiBudgetCache,
  bangkokMonthKey,
  previousBangkokMonthKey,
  recordCompanyAiCostAdjustment,
} from '../../../line-ai/application/company-ai-usage-meter';
import { nextBangkokMonthKey } from '../../../line-ai/application/company-ai-budget-policy';

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

/** One row of the grouped current-month read, with the defaults of a legacy (untagged) row. */
function eventGroup(over: Partial<BreakdownRow> = {}): BreakdownRow {
  return {
    usageTag: 'line_turn', requestKind: null, budgetBucket: null, usageBasis: null, eventKind: 'MODEL_CALL',
    rows: 1, costSatang: 0, inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheWriteInputTokens: 0,
    cacheReadSatang: null, cacheWriteSatang: null, firstAt: new Date('2026-09-17T03:00:00.000Z'), ...over,
  };
}

type BreakdownRow = {
  usageTag: string; requestKind: string | null; budgetBucket: string | null; usageBasis: string | null;
  eventKind: string; rows: number; costSatang: number; inputTokens: number; outputTokens: number;
  cacheReadInputTokens: number; cacheWriteInputTokens: number;
  cacheReadSatang: number | null; cacheWriteSatang: number | null; firstAt: Date;
};

/** A STARTER term that is running; tests override what they are about. */
const TERM = { tierKey: 'STARTER_249', monthlySlipLimit: 30, warmupUntil: null, warmupSlipLimit: null, capacityOverride: null,
  termEndsAt: new Date(Date.now() + 20 * 86_400_000), termDisabledAt: null };

function makePrisma(opts: {
  months?: Array<ReturnType<typeof monthRow>>;
  overrideSatang?: number | null;
  events?: BreakdownRow[];
  companyExists?: boolean;
  paid?: boolean;
  ocrConfig?: { enabled: boolean; monthlyLimit: number | null; version?: number; updatedAt?: Date; receiptQuotaEnforced?: boolean | null };
  ocrMonths?: Array<{ monthKey: string; usedCount: number }>;
  ocrSources?: Array<{ monthKey: string; sourceRoute: string; _count: { _all: number } }>;
  uploads?: [number, number];
  /** Split policy columns of the same configuration row (spec §12.5). */
  policy?: Record<string, unknown>;
  /** A trial or staff-set term (no receipt account); `paid` gives the same term a receipt account. */
  term?: Record<string, unknown> | null;
  /** Receipt lots the admission would see, and this month's base admissions of a monthly term. */
  lots?: Array<Record<string, unknown>>;
  monthlyUsed?: number;
} = {}) {
  const calls: { monthWhere?: any; rawSql?: string; rawParams?: unknown[]; ocrGroupBy?: any; uploadWhere?: any[]; transactionOptions?: any } = {};
  let uploadIndex = 0;
  const client: any = {
      company: {
        findUnique: async () => opts.companyExists === false ? null : { id: 'co-1', status: 'ACTIVE',
          planTerm: opts.paid || opts.term ? { ...TERM, ...opts.term, billingReceiptAccountId: opts.paid ? 'paid-account' : null } : null },
      },
      billingReceiptGrant: { findMany: async () => (opts.lots ?? []).map((lot) => ({ _count: { admissions: 0 }, revokedAt: null, ...lot })) },
      receiptUnitEntry: { groupBy: async () => [] },
      companyAiMonthlyUsage: {
        findMany: async (args: any) => { calls.monthWhere = args.where; return opts.months ?? []; },
      },
      companyAiConfiguration: {
        findUnique: async () => (opts.overrideSatang === undefined && !opts.ocrConfig && !opts.policy ? null : {
          ...opts.policy,
          monthlyBudgetSatang: opts.overrideSatang ?? null,
          ocrEnabled: opts.ocrConfig?.enabled ?? true,
          ocrMonthlyLimit: opts.ocrConfig?.monthlyLimit ?? null,
          receiptQuotaEnforced: opts.ocrConfig?.receiptQuotaEnforced ?? null,
          ocrConfigVersion: opts.ocrConfig?.version ?? 0,
          updatedAt: opts.ocrConfig?.updatedAt ?? new Date('2026-08-27T00:00:00.000Z'),
        }),
      },
      $queryRaw: async (strings: TemplateStringsArray, ...params: unknown[]) => {
        calls.rawSql = strings.join('?');
        calls.rawParams = params;
        return opts.events ?? [];
      },
      companyOcrMonthlyUsage: {
        findMany: async () => opts.ocrMonths ?? [],
      },
      companyOcrUsageEvent: {
        groupBy: async (args: any) => { calls.ocrGroupBy = args; return opts.ocrSources ?? []; },
        count: async () => opts.monthlyUsed ?? 0,
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
  for (const paid of [false, true]) for (const override of [null, false, true]) for (const startup of [false, true]) {
    it(`reports effective enforcement and source: paid=${paid}, override=${override}, startup=${startup}`, async () => {
      const prisma = makePrisma({ paid, ocrConfig: { enabled: true, monthlyLimit: null, receiptQuotaEnforced: override } });
      const result = await new GetPartnerAiUsageUseCase(prisma, { ...makeConfig(), receiptQuotaEnforced: startup }).execute('co-1');
      assert.deepEqual(result.ocr.planQuota, { enforced: paid || (override ?? startup), source: paid ? 'PAID_GRANTS' : override === null ? 'DEFAULT' : 'COMPANY', defaultEnforced: startup });
    });
  }
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
      // Every existing SHARED company now has the separate 50-credit CHAT default.
      policy: { mode: 'SHARED', chatCapSatang: 5_000, ocrCapSatang: null, source: 'ACTIVE',
        revision: `0:${bangkokMonthKey()}:ACTIVE`, pending: null, chatSource: 'DEFAULT' },
      // CHAT has its own remaining credit; OCR still uses the total only.
      position: {
        total: { spentSatang: 0, reservedSatang: 0, availableSatang: 5_000_000 },
        chat: { spentSatang: 0, reservedSatang: 0, availableSatang: 5_000 },
        ocr: { spentSatang: 0, reservedSatang: 0, availableSatang: null },
        unresolvedHolds: 0, breach: false,
      },
      chatCredit: { deal: null, cutoverAt: null },
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
      // Admin tab rework: the TOTAL override is the safety ceiling only; the chat credit is its own.
      policy: { mode: 'SHARED', chatCapSatang: 5_000, ocrCapSatang: null, source: 'ACTIVE',
        revision: `0:${bangkokMonthKey()}:ACTIVE`, pending: null, chatSource: 'DEFAULT' },
      position: {
        total: { spentSatang: 0, reservedSatang: 0, availableSatang: 900_000 },
        chat: { spentSatang: 0, reservedSatang: 0, availableSatang: 5_000 },
        ocr: { spentSatang: 0, reservedSatang: 0, availableSatang: null },
        unresolvedHolds: 0, breach: false,
      },
      chatCredit: { deal: null, cutoverAt: null },
    });
  });

  it('maps top tags cost-desc and asks the DB for the current month only, with bound parameters', async () => {
    const prisma = makePrisma({
      events: [
        eventGroup({ usageTag: 'line-turn', rows: 4, costSatang: 500, inputTokens: 40, outputTokens: 4 }),
        eventGroup({ usageTag: 'receipt-ocr', rows: 1, costSatang: 0 }),
      ],
    });
    const result = await new GetPartnerAiUsageUseCase(prisma, makeConfig()).execute('co-1');

    assert.deepEqual(result.topTags.map((row) => [row.tag, row.costSatang, row.calls]), [
      ['line-turn', 500, 4],
      ['receipt-ocr', 0, 1],
    ]);
    assert.equal(result.topTags[0]!.inputTokens, 40);
    assert.equal(result.topTags[0]!.cacheCostSatang, null, 'no snapshot is UNAVAILABLE, never ฿0.00');
    assert.deepEqual(prisma.calls.rawParams, ['co-1', CURRENT]);
    assert.match(prisma.calls.rawSql!, /GROUP BY "usageTag", "requestKind", "budgetBucket", "usageBasis", "eventKind"/);
  });

  it('caps top tags at 10 and puts the remainder in otherTags so the table reconciles', async () => {
    const events = Array.from({ length: 13 }, (_, index) =>
      eventGroup({ usageTag: `tag-${index}`, rows: 2, costSatang: 1_300 - index * 100, inputTokens: 5 }));
    const prisma = makePrisma({ events });
    const result = await new GetPartnerAiUsageUseCase(prisma, makeConfig()).execute('co-1');

    assert.equal(result.topTags.length, 10);
    assert.equal(result.topTags[0]!.tag, 'tag-0', 'highest cost first');
    assert.equal(result.otherTags.tags, 3);
    assert.equal(
      result.topTags.reduce((sum, row) => sum + row.costSatang, 0) + result.otherTags.costSatang,
      result.breakdown.total.costSatang,
      'top 10 + other must equal the event-derived month total',
    );
    assert.equal(result.otherTags.calls, 6);
    assert.equal(result.otherTags.inputTokens, 15);
  });

  it('breaks the month down by kind, bucket and basis with UNKNOWN always included', async () => {
    const prisma = makePrisma({
      events: [
        eventGroup({ usageTag: 'line.intake-route', requestKind: 'IMAGE', budgetBucket: 'OCR', usageBasis: 'PROVIDER_REPORTED', rows: 3, costSatang: 900, cacheReadSatang: 40, cacheWriteSatang: 60 }),
        eventGroup({ usageTag: 'line_turn', requestKind: 'TEXT', budgetBucket: 'CHAT', usageBasis: 'CONSERVATIVE_ESTIMATE', rows: 2, costSatang: 200, cacheReadSatang: 1, cacheWriteSatang: 2 }),
        // A legacy row: no metadata at all, so it must land in UNKNOWN on every axis.
        eventGroup({ usageTag: 'line_turn', rows: 5, costSatang: 400 }),
      ],
    });
    const result = await new GetPartnerAiUsageUseCase(prisma, makeConfig()).execute('co-1');
    const { breakdown } = result;

    assert.deepEqual(breakdown.byRequestKind.map((row) => [row.requestKind, row.costSatang, row.calls]),
      [['TEXT', 200, 2], ['IMAGE', 900, 3], ['OTHER', 0, 0], ['UNKNOWN', 400, 5]]);
    assert.deepEqual(breakdown.byBudgetBucket.map((row) => [row.budgetBucket, row.costSatang, row.calls]),
      [['CHAT', 200, 2], ['OCR', 900, 3], ['UNKNOWN', 400, 5]]);
    // `OPERATOR_CHARGED_AT_BOUND` (hold spec §4.2) is always emitted like every other key, so the
    // slice still reconciles with `total` when a month happens to carry no operator decision.
    assert.deepEqual(breakdown.byUsageBasis.map((row) => [row.usageBasis, row.costSatang, row.calls]),
      [['PROVIDER_REPORTED', 900, 3], ['CONSERVATIVE_ESTIMATE', 200, 2], ['OPERATOR_CHARGED_AT_BOUND', 0, 0], ['COMPANY_ABSORBED', 0, 0], ['UNKNOWN', 400, 5]]);

    for (const slice of [breakdown.byRequestKind, breakdown.byBudgetBucket, breakdown.byUsageBasis]) {
      assert.equal(slice.reduce((sum, row) => sum + row.costSatang, 0), breakdown.total.costSatang);
      assert.equal(slice.reduce((sum, row) => sum + row.calls, 0), breakdown.total.calls);
    }
    assert.deepEqual(breakdown.total.cacheCostSatang, { read: 41, write: 62 });
    // The untagged legacy slice has no priced evidence of its own.
    assert.equal(breakdown.byRequestKind.find((row) => row.requestKind === 'UNKNOWN')!.cacheCostSatang, null);
    assert.equal(breakdown.monthKey, CURRENT);
  });

  it('labels metadata coverage honestly and reports when tagging started', async () => {
    const complete = await new GetPartnerAiUsageUseCase(makePrisma({
      events: [eventGroup({ requestKind: 'TEXT', budgetBucket: 'CHAT', rows: 4 })],
    }), makeConfig()).execute('co-1');
    assert.equal(complete.breakdown.coverage.status, 'complete');
    assert.equal(complete.breakdown.coverage.firstMetadataAt, '2026-09-17T03:00:00.000Z');

    const partial = await new GetPartnerAiUsageUseCase(makePrisma({
      events: [
        eventGroup({ rows: 6, firstAt: new Date('2026-09-01T00:00:00.000Z') }),
        eventGroup({ requestKind: 'IMAGE', budgetBucket: 'OCR', rows: 2, firstAt: new Date('2026-09-17T03:00:00.000Z') }),
      ],
    }), makeConfig()).execute('co-1');
    assert.deepEqual(partial.breakdown.coverage, {
      status: 'partial', calls: 8, callsWithMetadata: 2, firstMetadataAt: '2026-09-17T03:00:00.000Z',
    });

    const none = await new GetPartnerAiUsageUseCase(makePrisma({ events: [eventGroup({ rows: 3 })] }), makeConfig()).execute('co-1');
    assert.equal(none.breakdown.coverage.status, 'none');
    assert.equal(none.breakdown.coverage.firstMetadataAt, null);
  });

  it('lets a COST_ADJUSTMENT move cost and tokens without ever counting as a call', async () => {
    const prisma = makePrisma({
      events: [
        eventGroup({ usageTag: 'line_turn', requestKind: 'TEXT', budgetBucket: 'CHAT', usageBasis: 'CONSERVATIVE_ESTIMATE', rows: 4, costSatang: 1_000, inputTokens: 900 }),
        eventGroup({ usageTag: 'line_turn', requestKind: 'TEXT', budgetBucket: 'CHAT', usageBasis: 'PROVIDER_REPORTED', eventKind: 'COST_ADJUSTMENT', rows: 1, costSatang: -250, inputTokens: -100 }),
      ],
    });
    const result = await new GetPartnerAiUsageUseCase(prisma, makeConfig()).execute('co-1');

    assert.equal(result.breakdown.total.costSatang, 750);
    assert.equal(result.breakdown.total.inputTokens, 800);
    assert.equal(result.breakdown.total.calls, 4, 'a correction is not a provider call');
    assert.deepEqual(result.breakdown.adjustments, { costSatang: -250, rows: 1 });
    assert.equal(result.breakdown.coverage.calls, 4);
    assert.equal(result.topTags[0]!.calls, 4, 'topTags counts model calls, not _count._all');
  });

  // J-07: an operator's "charge at the bound" is money, and it is NOT a model call. It rides the
  // COST_ADJUSTMENT eventKind for exactly that reason, so every existing rule already holds.
  it('shows an operator charge-at-bound under its own basis and never as a model call', async () => {
    const prisma = makePrisma({
      events: [
        eventGroup({ usageTag: 'line_turn', requestKind: 'TEXT', budgetBucket: 'CHAT', usageBasis: 'PROVIDER_REPORTED', rows: 2, costSatang: 500, inputTokens: 400 }),
        eventGroup({ usageTag: 'ai.credit_hold.charged_at_bound', requestKind: 'IMAGE', budgetBucket: 'OCR',
          usageBasis: 'OPERATOR_CHARGED_AT_BOUND', eventKind: 'COST_ADJUSTMENT', rows: 1, costSatang: 47, inputTokens: 0 }),
      ],
    });
    const { breakdown, topTags } = await new GetPartnerAiUsageUseCase(prisma, makeConfig()).execute('co-1');

    const operator = breakdown.byUsageBasis.find((row) => row.usageBasis === 'OPERATOR_CHARGED_AT_BOUND')!;
    assert.equal(operator.costSatang, 47, 'the money is in the breakdown under its own basis');
    assert.equal(operator.calls, 0, 'and it is not a model call');
    assert.equal(breakdown.total.costSatang, 547, 'the slices still reconcile with the total');
    assert.equal(breakdown.total.calls, 2);
    // It is NOT folded into UNKNOWN, which is what an unregistered key would have done.
    assert.equal(breakdown.byUsageBasis.find((row) => row.usageBasis === 'UNKNOWN')!.costSatang, 0);
    // The bucket it was held against still gets the money, so "available" moves for that scope.
    assert.equal(breakdown.byBudgetBucket.find((row) => row.budgetBucket === 'OCR')!.costSatang, 47);
    assert.equal(breakdown.coverage.calls, 2, 'coverage is about measured calls only');
    assert.deepEqual(breakdown.adjustments, { costSatang: 47, rows: 1 });
    assert.equal(topTags.find((tag) => tag.tag === 'ai.credit_hold.charged_at_bound')!.calls, 0);
  });

  it('returns an empty, zero-call month without inventing rows', async () => {
    const result = await new GetPartnerAiUsageUseCase(makePrisma(), makeConfig()).execute('co-1');

    assert.deepEqual(result.topTags, []);
    assert.deepEqual(result.otherTags, {
      tags: 0, costSatang: 0, calls: 0, inputTokens: 0, outputTokens: 0,
      cacheReadInputTokens: 0, cacheWriteInputTokens: 0, cacheCostSatang: null,
    });
    assert.equal(result.breakdown.total.calls, 0);
    assert.equal(result.breakdown.total.cacheCostSatang, null);
    assert.equal(result.breakdown.coverage.status, 'none');
    assert.equal(result.breakdown.byBudgetBucket.length, 3, 'the bucket rows exist even with no spend');
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
      receiptQuotaEnforced: null,
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
      const unreachable = await pgSpecUnreachableReason(
        () => Promise.all([reader.$queryRaw`SELECT 1`, writer.$queryRaw`SELECT 1`]), 'OCR_REQUIRE_POSTGRES');
      if (unreachable) return t.skip(unreachable);
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

  it('real PostgreSQL: the additive columns and the grouped breakdown query hold on the live catalog', async (t) => {
    const databaseUrl = process.env.DATABASE_URL?.trim();
    if (!databaseUrl) {
      if (process.env.OCR_REQUIRE_POSTGRES === 'true') throw new Error('OCR PostgreSQL test database is required');
      return t.skip('DATABASE_URL is not set');
    }
    const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
    let companyId = '';
    try {
      const unreachable = await pgSpecUnreachableReason(() => prisma.$queryRaw`SELECT 1`, 'OCR_REQUIRE_POSTGRES');
      if (unreachable) return t.skip(unreachable);
      companyId = (await prisma.company.create({
        data: { name: `ai-usage-breakdown-${process.pid}-${randomUUID()}`, status: 'ACTIVE' },
        select: { id: true },
      })).id;
      const base = {
        companyId, monthKey: CURRENT, modelId: 'global.anthropic.claude-sonnet-4-6', ok: true,
        thbPerUsd: 33, thbPerUsdSource: 'env-fallback' as const,
      };
      // A legacy row written by the pre-D1 binary: every new column stays at its default/NULL.
      const legacy = await prisma.aiUsageEvent.create({
        data: {
          ...base, sourceRoute: 'line-turn', usageTag: 'line_turn', costSatang: 400,
          inputTokens: 1_000, outputTokens: 100, cacheReadInputTokens: 0, cacheWriteInputTokens: 0,
        },
        select: { id: true, requestKind: true, budgetBucket: true, usageBasis: true, eventKind: true, pricingSnapshot: true },
      });
      assert.deepEqual(
        [legacy.requestKind, legacy.budgetBucket, legacy.usageBasis, legacy.eventKind, legacy.pricingSnapshot],
        [null, null, null, 'MODEL_CALL', null],
        'an old writer keeps inserting valid rows and is reported as UNKNOWN, not guessed',
      );
      const tagged = await prisma.aiUsageEvent.create({
        data: {
          ...base, sourceRoute: 'line-intake-route', usageTag: 'line.intake-route', costSatang: 1_000,
          inputTokens: 2_000, outputTokens: 300, cacheReadInputTokens: 5_000, cacheWriteInputTokens: 4_000,
          requestKind: 'IMAGE', budgetBucket: 'OCR', usageBasis: 'PROVIDER_REPORTED', eventKind: 'MODEL_CALL',
          pricingSnapshot: {
            usdPerMTok: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }, thbPerUsd: 33, unknownModel: false,
            componentSatang: { input: 20, output: 15, cacheRead: 5, cacheWrite: 50, rounding: 910 },
          },
        },
        select: { id: true },
      });
      await prisma.aiUsageEvent.create({
        data: {
          ...base, sourceRoute: 'line-intake-route', usageTag: 'line.intake-route', costSatang: -150,
          inputTokens: -200, outputTokens: 0, cacheReadInputTokens: 0, cacheWriteInputTokens: 0,
          requestKind: 'IMAGE', budgetBucket: 'OCR', usageBasis: 'PROVIDER_REPORTED',
          eventKind: 'COST_ADJUSTMENT', adjustsEventId: tagged.id, correctionKey: `settle-${randomUUID()}`,
        },
      });
      // A snapshot whose cacheRead component is a STRING (a future writer, or a manual fix). The
      // cast must not abort the whole admin read; the malformed component contributes nothing and
      // its well-formed sibling still counts.
      await prisma.aiUsageEvent.create({
        data: {
          ...base, sourceRoute: 'line-turn', usageTag: 'line_turn', costSatang: 0,
          inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheWriteInputTokens: 0,
          requestKind: 'TEXT', budgetBucket: 'CHAT', usageBasis: 'PROVIDER_REPORTED',
          pricingSnapshot: { componentSatang: { input: 0, output: 0, cacheRead: '5', cacheWrite: 7, rounding: 0 } },
        },
      });
      await prisma.companyAiMonthlyUsage.create({
        data: {
          companyId, monthKey: CURRENT, costSatang: 1_250, callCount: 3,
          inputTokens: 2_800, outputTokens: 400, cacheReadInputTokens: 5_000, cacheWriteInputTokens: 4_000,
        },
      });

      __resetCompanyAiBudgetCache();
      const result = await new GetPartnerAiUsageUseCase({ client: prisma } as any, makeConfig()).execute(companyId);

      assert.equal(result.breakdown.total.costSatang, 1_250);
      assert.equal(result.breakdown.total.calls, 3, 'the adjustment row is not a provider call');
      assert.equal(result.current?.costSatang, 1_250, 'the running aggregate agrees with the events');
      assert.deepEqual(result.breakdown.adjustments, { costSatang: -150, rows: 1 });
      assert.deepEqual(result.breakdown.byBudgetBucket.map((row) => [row.budgetBucket, row.costSatang, row.calls]),
        [['CHAT', 0, 1], ['OCR', 850, 1], ['UNKNOWN', 400, 1]]);
      assert.deepEqual(result.breakdown.byRequestKind.find((row) => row.requestKind === 'IMAGE')!.cacheCostSatang,
        { read: 5, write: 50 }, 'component cost is summed out of the JSON snapshot');
      assert.deepEqual(result.breakdown.byRequestKind.find((row) => row.requestKind === 'TEXT')!.cacheCostSatang,
        { read: 0, write: 7 }, 'a string component contributes nothing instead of aborting the read');
      assert.deepEqual(result.breakdown.total.cacheCostSatang, { read: 5, write: 57 });
      assert.equal(result.breakdown.byRequestKind.find((row) => row.requestKind === 'UNKNOWN')!.cacheCostSatang, null);
      assert.deepEqual(result.breakdown.coverage.status, 'partial');
      assert.equal(result.breakdown.coverage.callsWithMetadata, 2);
      assert.equal(
        result.topTags.reduce((sum, row) => sum + row.costSatang, 0) + result.otherTags.costSatang,
        result.breakdown.total.costSatang,
      );
      // The replay fence is a real unique index, not an application convention.
      const applied = await prisma.aiUsageEvent.findFirstOrThrow({
        where: { companyId, eventKind: 'COST_ADJUSTMENT' }, select: { correctionKey: true },
      });
      await assert.rejects(() => prisma.aiUsageEvent.create({
        data: {
          ...base, sourceRoute: 'line-turn', usageTag: 'line_turn', costSatang: 0,
          inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheWriteInputTokens: 0,
          eventKind: 'COST_ADJUSTMENT', adjustsEventId: tagged.id, correctionKey: applied.correctionKey!,
        },
      }));

      // Two settlements of the same evidence racing each other: the loser's INSERT hits the unique
      // index, its whole transaction rolls back, and it reports 'duplicate' rather than throwing.
      const raced = await Promise.all([
        recordCompanyAiCostAdjustment({ client: prisma } as any, { eventId: tagged.id, correctionKey: 'race-key', costSatang: -100 }),
        recordCompanyAiCostAdjustment({ client: prisma } as any, { eventId: tagged.id, correctionKey: 'race-key', costSatang: -100 }),
      ]);
      assert.deepEqual([...raced].sort(), ['applied', 'duplicate']);
      assert.equal((await prisma.companyAiMonthlyUsage.findUniqueOrThrow({
        where: { companyId_monthKey: { companyId, monthKey: CURRENT } }, select: { costSatang: true, callCount: true },
      })).costSatang, 1_150, 'the aggregate moved exactly once');
      assert.equal(await prisma.aiUsageEvent.count({ where: { companyId, correctionKey: 'race-key' } }), 1);
    } finally {
      if (companyId) await prisma.company.deleteMany({ where: { id: companyId } });
      await prisma.$disconnect().catch(() => undefined);
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

describe('GetPartnerAiUsageUseCase budget policy', () => {
  const read = (opts: Parameters<typeof makePrisma>[0]) =>
    new GetPartnerAiUsageUseCase(makePrisma(opts), makeConfig()).execute('co-1');

  it('reports an ACTIVE split with both caps and the revision the writer will fence on', async () => {
    const result = await read({ overrideSatang: 10_000, policy: {
      budgetMode: 'SPLIT', chatMonthlyBudgetSatang: 3_000, ocrMonthlyBudgetSatang: 7_000, budgetConfigVersion: 2, pendingBudgetPolicy: null,
    } });
    assert.deepEqual(result.budget.policy, {
      mode: 'SPLIT', chatCapSatang: 3_000, ocrCapSatang: 7_000, source: 'ACTIVE',
      revision: `2:${CURRENT}:ACTIVE`, pending: null, chatSource: 'SPLIT',
    });
  });

  it('separates "in force now" from "starts next month" so the console can show both', async () => {
    const pending = { mode: 'SPLIT', chatMonthlyBudgetSatang: 3_000, ocrMonthlyBudgetSatang: 7_000, effectiveMonthKey: nextBangkokMonthKey() };
    const result = await read({ overrideSatang: 10_000, policy: { budgetMode: 'SHARED', budgetConfigVersion: 1, pendingBudgetPolicy: pending } });
    assert.equal(result.budget.policy.mode, 'SHARED');
    assert.deepEqual(result.budget.policy.pending, pending);
  });

  it('surfaces an allocation that no longer fits the live total instead of quietly showing caps', async () => {
    const result = await read({ overrideSatang: 5_000, policy: {
      budgetMode: 'SPLIT', chatMonthlyBudgetSatang: 3_000, ocrMonthlyBudgetSatang: 7_000, budgetConfigVersion: 2, pendingBudgetPolicy: null,
    } });
    assert.equal(result.budget.policy.invalidReason, 'SPLIT_EXCEEDS_TOTAL');
    assert.equal(result.budget.effectiveSatang, 5_000, 'the total the seams compare against is unchanged');
  });
});

describe('GetPartnerAiUsageUseCase — chat credit and receipt images (admin tab rework 2026-09-29)', () => {
  const soon = new Date(Date.now() + 10 * 86_400_000);
  const lot = (id: string, kind: string, units: number, admissions: number, expiresAt = soon) => ({
    id, kind, units, availableAt: new Date(Date.now() - 86_400_000), expiresAt, createdAt: new Date(Date.now() - 86_400_000),
    _count: { admissions },
  });

  it('names where the chat credit comes from: an admin setting wins over a live sales deal', async () => {
    const endsAt = new Date(Date.now() + 30 * 86_400_000);
    const result = await new GetPartnerAiUsageUseCase(makePrisma({ policy: { budgetMode: 'SHARED', chatMonthlyBudgetSatang: 15_000,
      salesDealChatCreditSatang: 30_000, salesDealChatCreditEndsAt: endsAt } }), makeConfig()).execute('co-1');
    assert.equal(result.budget.policy.chatCapSatang, 15_000);
    assert.equal(result.budget.policy.chatSource, 'ADMIN');
    assert.deepEqual(result.budget.chatCredit, { deal: { satang: 30_000, endsAt: endsAt.toISOString() }, cutoverAt: null });
    assert.equal(result.budget.position.chat.availableSatang, 15_000);

    const deal = await new GetPartnerAiUsageUseCase(makePrisma({ policy: { salesDealChatCreditSatang: 30_000, salesDealChatCreditEndsAt: endsAt } }),
      makeConfig()).execute('co-1');
    assert.deepEqual([deal.budget.policy.chatCapSatang, deal.budget.policy.chatSource], [30_000, 'SALES_DEAL']);
  });

  it('a paid package reads its lots: package first, then what the team gave or the shop bought', async () => {
    const result = await new GetPartnerAiUsageUseCase(makePrisma({ paid: true,
      lots: [lot('pkg', 'INITIAL', 30, 12), lot('gift', 'ADD_ON_ADMIN', 5, 0)] }), makeConfig()).execute('co-1');
    assert.deepEqual(result.ocr.receiptImages, {
      basis: 'PACKAGE_LOTS', tierKey: 'STARTER_249', enforced: true, active: true,
      package: { limit: 30, used: 12, remaining: 18, expiresAt: soon.toISOString() },
      additional: { remaining: 5, expiresAt: soon.toISOString() }, totalRemaining: 23,
    });
  });

  it('a trial or staff-set term reads its monthly allowance with the enforcement in force', async () => {
    const trial = await new GetPartnerAiUsageUseCase(makePrisma({ term: { tierKey: 'FREE_TRIAL_15', monthlySlipLimit: 15 }, monthlyUsed: 7 }),
      { ...makeConfig(), receiptQuotaEnforced: true }).execute('co-1');
    assert.deepEqual(trial.ocr.receiptImages, {
      basis: 'MONTHLY', tierKey: 'FREE_TRIAL_15', enforced: true, active: true,
      package: { limit: 15, used: 7, remaining: 8, expiresAt: null }, additional: { remaining: 0, expiresAt: null }, totalRemaining: 8,
    });
    const observed = await new GetPartnerAiUsageUseCase(makePrisma({ term: {}, monthlyUsed: 40,
      ocrConfig: { enabled: true, monthlyLimit: null, receiptQuotaEnforced: false } }), { ...makeConfig(), receiptQuotaEnforced: true }).execute('co-1');
    assert.equal(observed.ocr.receiptImages?.enforced, false, 'the company setting wins over the platform default');
    assert.equal(observed.ocr.receiptImages?.package?.remaining, 0, 'used beyond the allowance never reads as negative');
  });

  it('a shop without a package term has no image limit from a package', async () => {
    const result = await new GetPartnerAiUsageUseCase(makePrisma(), makeConfig()).execute('co-1');
    assert.deepEqual(result.ocr.receiptImages, { basis: 'NONE', tierKey: null, enforced: false, active: true, package: null,
      additional: { remaining: 0, expiresAt: null }, totalRemaining: null });
  });

  it('a paid package that ended or was held reads as inactive, and a current temporary tier is named', () => {
    const now = new Date();
    const term = { tierKey: 'STARTER_249', monthlySlipLimit: 30, warmupUntil: null, warmupSlipLimit: null, billingReceiptAccountId: 'acct',
      capacityOverride: null, termEndsAt: new Date(now.getTime() - 1), termDisabledAt: null };
    assert.equal(partnerReceiptImages({ term, companyActive: true, lots: [], monthlyUsed: 0, enforced: true, now }).active, false);
    const held = partnerReceiptImages({ term: { ...term, termEndsAt: soon, termDisabledAt: now }, companyActive: true, lots: [], monthlyUsed: 0, enforced: true, now });
    assert.deepEqual([held.active, held.package, held.totalRemaining], [false, { limit: 0, used: 0, remaining: 0, expiresAt: null }, 0]);
  });
});


describe('company-absorbed admin usage', () => {
  it('shows our cost separately while the customer month remains unchanged', async () => {
    const monthKey = bangkokMonthKey();
    const prisma = makePrisma({ months: [{ monthKey, costSatang: 50, callCount: 1, inputTokens: 10, outputTokens: 5,
      cacheReadInputTokens: 0, cacheWriteInputTokens: 0 }], events: [
      eventGroup({ usageBasis: 'PROVIDER_REPORTED', costSatang: 50, rows: 1 }),
      eventGroup({ usageBasis: 'COMPANY_ABSORBED', costSatang: 25, rows: 2 }),
    ] });
    const result = await new GetPartnerAiUsageUseCase(prisma, makeConfig()).execute('co-1');
    assert.equal(result.current!.costSatang, 50);
    assert.equal(result.breakdown.total.costSatang, 75);
    const absorbed = result.breakdown.byUsageBasis.find(row => row.usageBasis === 'COMPANY_ABSORBED')!;
    assert.equal(absorbed.costSatang, 25);
    assert.equal(absorbed.calls, 2);
    assert.equal(result.breakdown.byUsageBasis.reduce((sum, row) => sum + row.costSatang, 0), 75);
  });
});
