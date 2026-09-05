import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AI_BANK_STATEMENT_MAX_PROVIDER_CALLS,
  AI_DOCUMENT_OCR_TIMEOUT_MS,
  AI_RECEIPT_OCR_CLIENT_TIMEOUT_MS,
  AI_RECEIPT_OCR_MAX_PROVIDER_CALLS,
  aiGatewayClientTimeoutMs,
} from '@watchdog-bms/contracts';
import { Logger } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import type { AiUsageEntry } from '@watchdog-bms/contracts';
import { PrismaClient } from '../../../generated/prisma/client';
import { pgSpecUnreachableReason } from '../../../common/database/pg-spec-guard';
import { RedisRateLimitService } from '../../../common/security/redis-rate-limit.service';
import { __resetFxCache } from './ai-fx-rate';
import {
  admitCompanyOcr,
  companyOcrErrorCode,
  isOcrPreProviderHttpStatus,
  isOcrPreProviderRefusal,
  releaseCompanyOcrAdmission,
} from './company-ocr-governance';
import {
  __resetCompanyAiBudgetCache,
  assertCompanyAiBudget,
  bangkokMonthKey,
  recordCompanyAiUsage,
  resolvePlatformAiBudget,
  retryBusyAdmission,
  runWithCompanyAiBudgetAdmission,
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

type OcrEvent = { id: string; companyId: string; monthKey: string; sourceRoute: string; requestId: string };

function fakeOcrPrisma(input: {
  enabled?: boolean;
  limit?: number | null;
  used?: number;
  /** P10-L §15.1 plan ceiling. Absent = no `CompanyPlanTerm` row = grandfathered unlimited, which is
   *  what every ops-brake case below is, so none of their expectations move. */
  planTerm?: { tierKey: string; monthlySlipLimit: number; warmupUntil?: Date | null; warmupSlipLimit?: number | null } | null;
  enforceReceiptQuota?: boolean;
  auditedThisMonth?: boolean;
} = {}) {
  const auditWrites: any[] = [];
  const events: OcrEvent[] = [];
  let usedCount = input.used ?? 0;
  let queue = Promise.resolve();
  let lockCalls = 0;
  const lockKeys: string[] = [];
  const tx = {
    $executeRaw: async (_strings: TemplateStringsArray, key: string) => { lockCalls += 1; lockKeys.push(key); },
    companyOcrUsageEvent: {
      findUnique: async ({ where }: any) => {
        const key = where.companyId_sourceRoute_requestId;
        return events.find((event) => event.companyId === key.companyId
          && event.sourceRoute === key.sourceRoute && event.requestId === key.requestId) ?? null;
      },
      create: async ({ data }: any) => {
        const event = { id: `event-${events.length + 1}`, ...data };
        events.push(event);
        return event;
      },
      delete: async ({ where }: any) => {
        const index = events.findIndex((event) => event.id === where.id);
        return events.splice(index, 1)[0];
      },
    },
    companyAiConfiguration: {
      findUnique: async () => input.enabled === undefined && input.limit === undefined
        ? null
        : { ocrEnabled: input.enabled ?? true, ocrMonthlyLimit: input.limit ?? null },
    },
    companyOcrMonthlyUsage: {
      findUnique: async () => usedCount === 0 ? null : { usedCount },
      upsert: async () => ({ usedCount: ++usedCount }),
      updateMany: async () => {
        if (usedCount <= 0) return { count: 0 };
        usedCount -= 1;
        return { count: 1 };
      },
    },
    companyPlanTerm: {
      findUnique: async () => input.planTerm
        ? { warmupUntil: null, warmupSlipLimit: null, ...input.planTerm }
        : null,
    },
    auditLog: {
      findFirst: async () => input.auditedThisMonth ? { id: 'audit-1' } : null,
    },
  };
  const prisma = {
    client: {
      $transaction: <T>(fn: (value: typeof tx) => Promise<T>): Promise<T> => {
        const result = queue.then(() => fn(tx));
        queue = result.then(() => undefined, () => undefined);
        return result;
      },
      // Post-commit rollout evidence for the shadow-mode plan ceiling; never inside the transaction.
      auditLog: { create: async ({ data }: any) => { auditWrites.push(data); return data; } },
    },
  } as any;
  return { prisma, events, usedCount: () => usedCount, lockCalls: () => lockCalls, lockKeys, auditWrites };
}

const baseOcrAdmission = {
  companyId: 'co-1',
  sourceRoute: 'receipt-ocr-web' as const,
  requestId: 'req-1',
  monthKey: '2026-08',
};

describe('company OCR admission', () => {
  it('keeps legacy companies enabled and unlimited, then records one event + aggregate', async () => {
    const state = fakeOcrPrisma();
    const result = await admitCompanyOcr(state.prisma, baseOcrAdmission);
    assert.deepEqual(result, { allowed: true, monthKey: '2026-08', usedCount: 1, monthlyLimit: null });
    assert.equal(state.events.length, 1);
    assert.equal(state.usedCount(), 1);
    assert.equal(state.lockCalls(), 2);
    assert.deepEqual(state.lockKeys, ['partner-ocr-config:co-1', 'ocr-quota:co-1:2026-08']);
  });

  it('fails closed when disabled or exhausted without consuming a read', async () => {
    const disabled = fakeOcrPrisma({ enabled: false, limit: 10 });
    const disabledResult = await admitCompanyOcr(disabled.prisma, baseOcrAdmission);
    assert.deepEqual(disabledResult, { allowed: false, reason: 'disabled' });
    assert.equal(companyOcrErrorCode(disabledResult as any), 'OCR_FEATURE_DISABLED');
    assert.equal(disabled.usedCount(), 0);

    const full = fakeOcrPrisma({ limit: 2, used: 2 });
    const fullResult = await admitCompanyOcr(full.prisma, baseOcrAdmission);
    assert.deepEqual(fullResult, { allowed: false, reason: 'exceeded', usedCount: 2, monthlyLimit: 2 });
    assert.equal(full.events.length, 0);
  });

  it('uses the request fence: an exact retry neither increments nor reaches a second provider admission', async () => {
    const state = fakeOcrPrisma({ limit: 10 });
    assert.equal((await admitCompanyOcr(state.prisma, baseOcrAdmission)).allowed, true);
    const replay = await admitCompanyOcr(state.prisma, baseOcrAdmission);
    assert.deepEqual(replay, { allowed: false, reason: 'duplicate' });
    assert.equal(state.usedCount(), 1);
    assert.equal(state.events.length, 1);
  });

  it('atomically releases a pre-provider refusal and permits a later retry', async () => {
    const state = fakeOcrPrisma({ limit: 1 });
    assert.equal((await admitCompanyOcr(state.prisma, baseOcrAdmission)).allowed, true);
    assert.equal(await releaseCompanyOcrAdmission(state.prisma, baseOcrAdmission), true);
    assert.equal(state.events.length, 0);
    assert.equal(state.usedCount(), 0);
    assert.equal((await admitCompanyOcr(state.prisma, baseOcrAdmission)).allowed, true);
    assert.equal(state.events.length, 1);
    assert.equal(state.usedCount(), 1);
  });

  it('retries two transient release failures across a bounded recovery window', async () => {
    const state = fakeOcrPrisma({ limit: 1 });
    assert.equal((await admitCompanyOcr(state.prisma, baseOcrAdmission)).allowed, true);
    const transaction = state.prisma.client.$transaction.bind(state.prisma.client);
    let failuresRemaining = 2;
    state.prisma.client.$transaction = (...args: any[]) => {
      if (failuresRemaining > 0) {
        failuresRemaining -= 1;
        return Promise.reject(new Error('TRANSIENT_DB_FAILURE'));
      }
      return transaction(...args);
    };
    assert.equal(await releaseCompanyOcrAdmission(state.prisma, baseOcrAdmission), true);
    assert.equal(state.events.length, 0);
    assert.equal(state.usedCount(), 0);
    assert.equal((await admitCompanyOcr(state.prisma, baseOcrAdmission)).allowed, true);
  });

  it('fails closed and emits a compensation alert when every release attempt is exhausted', async () => {
    const state = fakeOcrPrisma();
    assert.equal((await admitCompanyOcr(state.prisma, baseOcrAdmission)).allowed, true);
    const warn = mock.method(Logger.prototype, 'warn', () => undefined);
    state.prisma.client.$transaction = async () => { throw new Error('DB_STILL_DOWN'); };

    assert.equal(await releaseCompanyOcrAdmission(state.prisma, baseOcrAdmission), false);
    assert.equal(state.events.length, 1, 'conservative quota remains when compensation cannot be proved');
    assert.equal(state.usedCount(), 1);
    assert.equal(warn.mock.calls.some((call) =>
      (call.arguments[0] as any)?.actionRequired === 'OCR_QUOTA_COMPENSATION_REQUIRED'
      && (call.arguments[0] as any)?.msg === 'ocr.quota.release_unavailable'
      && (call.arguments[0] as any)?.riskLevel === 'HIGH'
      && (call.arguments[0] as any)?.attempts === 4), true);
    warn.mock.restore();
  });

  it('releases only exact pre-provider status/code pairs from the gateway', () => {
    assert.equal(isOcrPreProviderRefusal({ status: 'not_configured', errorCode: 'PROVIDER_CONFIG_MISSING' }), true);
    assert.equal(isOcrPreProviderRefusal({ status: 'not_configured', errorCode: 'PDF_PROVIDER_UNSUPPORTED' }), true);
    assert.equal(isOcrPreProviderRefusal({ status: 'failed', errorCode: 'UNSUPPORTED_MIME_TYPE' }), true);
    assert.equal(isOcrPreProviderRefusal({ status: 'failed', errorCode: 'AI_GATEWAY_ERROR_401' }), false);
    assert.equal(isOcrPreProviderHttpStatus(401), true);
    assert.equal(isOcrPreProviderHttpStatus(503), false);
    assert.equal(isOcrPreProviderRefusal({ status: 'ok', errorCode: 'PROVIDER_CONFIG_MISSING' }), false);
    assert.equal(isOcrPreProviderRefusal({ status: 'failed', errorCode: 'PROVIDER_CONFIG_MISSING' }), false);
    assert.equal(isOcrPreProviderRefusal({ status: 'not_configured', errorCode: 'UNSUPPORTED_MIME_TYPE' }), false);
    assert.equal(isOcrPreProviderRefusal({ status: 'failed', errorCode: 'AI_GATEWAY_ERROR_503' }), false);
  });

  it('serializes concurrent calls at limit-1 so exactly one wins', async () => {
    const state = fakeOcrPrisma({ limit: 2, used: 1 });
    const results = await Promise.all([
      admitCompanyOcr(state.prisma, { ...baseOcrAdmission, requestId: 'req-a' }),
      admitCompanyOcr(state.prisma, { ...baseOcrAdmission, requestId: 'req-b' }),
    ]);
    assert.equal(results.filter((result) => result.allowed).length, 1);
    assert.equal(results.filter((result) => !result.allowed && result.reason === 'exceeded').length, 1);
    assert.equal(state.usedCount(), 2);
    assert.equal(state.events.length, 1);
  });

  it('returns unavailable rather than allowing an unmetered read when the store fails', async () => {
    const result = await admitCompanyOcr({
      client: { $transaction: async () => { throw new Error('DB_DOWN'); } },
    } as any, baseOcrAdmission);
    assert.deepEqual(result, { allowed: false, reason: 'unavailable' });
  });

  it('real PostgreSQL: limit 2 with used 1 admits only one of two concurrent requests', async (t) => {
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
    const monthKey = '2099-08';
    try {
      const unreachable = await pgSpecUnreachableReason(
        () => Promise.all(clients.map((client) => client.$queryRaw`SELECT 1`)), 'OCR_REQUIRE_POSTGRES');
      if (unreachable) return t.skip(unreachable);
      companyId = (await clients[0]!.company.create({
        data: { name: `ocr-admission-race-${process.pid}-${randomUUID()}`, status: 'ACTIVE' },
        select: { id: true },
      })).id;
      await clients[0]!.companyAiConfiguration.create({
        data: { companyId, ocrEnabled: true, ocrMonthlyLimit: 2 },
      });
      await clients[0]!.companyOcrMonthlyUsage.create({
        data: { companyId, monthKey, usedCount: 1 },
      });

      const requestIds = clients.map((_client, index) => `ocr-race-${index}-${randomUUID()}`);
      const results = await Promise.all(clients.map((client, index) => admitCompanyOcr(
        { client } as any,
        {
          companyId,
          monthKey,
          sourceRoute: 'receipt-ocr-web',
          requestId: requestIds[index]!,
        },
      )));

      assert.equal(results.filter((result) => result.allowed).length, 1);
      assert.equal(results.filter((result) => !result.allowed && result.reason === 'exceeded').length, 1);
      assert.equal(await clients[0]!.companyOcrUsageEvent.count({ where: { companyId, monthKey } }), 1);
      assert.equal((await clients[0]!.companyOcrMonthlyUsage.findUniqueOrThrow({
        where: { companyId_monthKey: { companyId, monthKey } },
        select: { usedCount: true },
      })).usedCount, 2);

      const admittedIndex = results.findIndex((result) => result.allowed);
      const releasedInput = {
        companyId,
        sourceRoute: 'receipt-ocr-web' as const,
        requestId: requestIds[admittedIndex]!,
      };
      assert.equal(await releaseCompanyOcrAdmission({ client: clients[0] } as any, releasedInput), true);
      assert.equal(await clients[0]!.companyOcrUsageEvent.count({ where: { companyId, monthKey } }), 0);
      assert.equal((await clients[0]!.companyOcrMonthlyUsage.findUniqueOrThrow({
        where: { companyId_monthKey: { companyId, monthKey } },
        select: { usedCount: true },
      })).usedCount, 1);
      assert.equal((await admitCompanyOcr(
        { client: clients[0] } as any,
        { ...releasedInput, monthKey },
      )).allowed, true, 'a released pre-provider refusal must be retryable');
    } finally {
      if (companyId) await clients[0]!.company.deleteMany({ where: { id: companyId } });
      await Promise.all(clients.map((client) => client.$disconnect().catch(() => undefined)));
    }
  });
});

/**
 * P10-L §15.1 / review G-01. `CompanyPlanTerm.monthlySlipLimit` was a number nothing read — a
 * "free trial, 15 receipts" with no ceiling. It is layered onto THIS admission rather than counted
 * beside it: two monthly counters would give support and the admin console two different
 * "receipts this month" numbers for the same shop.
 */
describe('company OCR admission — commercial plan ceiling', () => {
  const FREE_TRIAL = { tierKey: 'FREE_TRIAL_15', monthlySlipLimit: 15 };
  const enforced = { ...baseOcrAdmission, enforceReceiptQuota: true };

  it('refuses receipt 16 of 15 as plan_exceeded, with its own code and no usage event', async () => {
    const state = fakeOcrPrisma({ planTerm: FREE_TRIAL, used: 15 });
    const result = await admitCompanyOcr(state.prisma, enforced);

    assert.deepEqual(result, {
      allowed: false, reason: 'plan_exceeded', usedCount: 15, monthlyLimit: 15, tierKey: 'FREE_TRIAL_15',
    });
    assert.equal(companyOcrErrorCode(result as any), 'RECEIPT_QUOTA_EXCEEDED');
    assert.equal(state.events.length, 0, 'a refused read is not a document read');
    assert.equal(state.usedCount(), 15);
  });

  it('applies to both receipt routes and NEVER to a bank statement', async () => {
    for (const sourceRoute of ['receipt-ocr-web', 'receipt-ocr-line'] as const) {
      const blocked = fakeOcrPrisma({ planTerm: FREE_TRIAL, used: 15 });
      assert.equal((await admitCompanyOcr(blocked.prisma, { ...enforced, sourceRoute })).allowed, false, sourceRoute);
    }
    // A statement import is an accounting job, not one of the receipts the shop bought.
    const statements = fakeOcrPrisma({ planTerm: FREE_TRIAL, used: 15 });
    const result = await admitCompanyOcr(statements.prisma, { ...enforced, sourceRoute: 'bank-statement-extract' });
    assert.equal(result.allowed, true);
    assert.equal(statements.usedCount(), 16);
  });

  it('lets the OPS brake keep its own code and copy when it is the lower ceiling', async () => {
    // ocrMonthlyLimit 10 < plan 15: this is the platform stopping spend, not the shop running out.
    const state = fakeOcrPrisma({ limit: 10, used: 10, planTerm: FREE_TRIAL });
    const result = await admitCompanyOcr(state.prisma, enforced);

    assert.deepEqual(result, { allowed: false, reason: 'exceeded', usedCount: 10, monthlyLimit: 10 });
    assert.equal(companyOcrErrorCode(result as any), 'OCR_MONTHLY_LIMIT_EXCEEDED');
  });

  it('lets the PLAN ceiling bind when it is the lower of the two', async () => {
    const state = fakeOcrPrisma({ limit: 50, used: 15, planTerm: FREE_TRIAL });
    const result = await admitCompanyOcr(state.prisma, enforced);

    assert.equal(result.allowed, false);
    assert.equal((result as any).reason, 'plan_exceeded');
    assert.equal((result as any).monthlyLimit, 15, 'the refusal names the ceiling that actually bound');
  });

  it('uses the warm-up ceiling inside its window and the tier ceiling outside it', async () => {
    const warmup = (warmupUntil: Date) => ({ ...FREE_TRIAL, warmupUntil, warmupSlipLimit: 10 });

    const inside = fakeOcrPrisma({ planTerm: warmup(new Date(Date.now() + 60_000)), used: 10 });
    assert.equal((await admitCompanyOcr(inside.prisma, enforced)).allowed, false, 'warm-up caps at 10');

    // One minute past the window the trial's own 15 applies, so the 11th receipt goes through.
    const outside = fakeOcrPrisma({ planTerm: warmup(new Date(Date.now() - 60_000)), used: 10 });
    assert.equal((await admitCompanyOcr(outside.prisma, enforced)).allowed, true);
  });

  it('never blocks a company with no plan term row', async () => {
    // A shop that predates P29 is grandfathered; the day enforcement is switched on must not be the
    // day it discovers a ceiling it never bought.
    const state = fakeOcrPrisma({ used: 9_999 });
    assert.equal((await admitCompanyOcr(state.prisma, enforced)).allowed, true);
  });

  it('counts and audits but never blocks while RECEIPT_QUOTA_ENFORCED is off', async () => {
    const state = fakeOcrPrisma({ planTerm: FREE_TRIAL, used: 15 });
    const result = await admitCompanyOcr(state.prisma, { ...baseOcrAdmission, enforceReceiptQuota: false });

    assert.equal(result.allowed, true, 'production counts for a month before it refuses anything');
    assert.equal(state.usedCount(), 16);
    assert.equal(state.auditWrites.length, 1, 'the rollout gets one durable row per company-month');
    assert.equal(state.auditWrites[0]!.action, 'plan.receipt_quota.would_block');
    assert.equal(state.auditWrites[0]!.requestId, 'plan-quota-co-1-2026-08');
    assert.deepEqual(state.auditWrites[0]!.metadataJson, {
      monthKey: '2026-08', sourceRoute: 'receipt-ocr-web', usedCount: 15, planLimit: 15, tierKey: 'FREE_TRIAL_15',
    });
  });

  it('does not write a second would-block row in the same month', async () => {
    const state = fakeOcrPrisma({ planTerm: FREE_TRIAL, used: 15, auditedThisMonth: true });
    assert.equal((await admitCompanyOcr(state.prisma, baseOcrAdmission)).allowed, true);
    assert.deepEqual(state.auditWrites, []);
  });

  it('does not audit a shop that is merely near its ceiling', async () => {
    const state = fakeOcrPrisma({ planTerm: FREE_TRIAL, used: 14 });
    assert.equal((await admitCompanyOcr(state.prisma, baseOcrAdmission)).allowed, true);
    assert.deepEqual(state.auditWrites, []);
  });

  it('real PostgreSQL: the plan ceiling admits only one of two concurrent reads at limit-1', async (t) => {
    const databaseUrl = process.env.DATABASE_URL?.trim();
    if (!databaseUrl) return t.skip('DATABASE_URL is not set');

    const clients = [
      new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) }),
      new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) }),
    ];
    let companyId = '';
    const monthKey = '2099-09';
    try {
      const unreachable = await pgSpecUnreachableReason(
        () => Promise.all(clients.map((client) => client.$queryRaw`SELECT 1`)), 'OCR_REQUIRE_POSTGRES');
      if (unreachable) return t.skip(unreachable);
      companyId = (await clients[0]!.company.create({
        data: { name: `plan-quota-race-${process.pid}-${randomUUID()}`, status: 'ACTIVE' },
        select: { id: true },
      })).id;
      const now = new Date();
      await clients[0]!.companyPlanTerm.create({
        data: {
          companyId, tierKey: 'FREE_TRIAL_15', branchLimit: 1, employeeLimit: 3, monthlySlipLimit: 15,
          termStartAt: now, termEndsAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
        },
      });
      await clients[0]!.companyOcrMonthlyUsage.create({ data: { companyId, monthKey, usedCount: 14 } });

      const results = await Promise.all(clients.map((client, index) => admitCompanyOcr(
        { client } as any,
        {
          companyId, monthKey, sourceRoute: 'receipt-ocr-web',
          requestId: `plan-race-${index}-${randomUUID()}`, enforceReceiptQuota: true,
        },
      )));

      assert.equal(results.filter((result) => result.allowed).length, 1);
      assert.equal(results.filter((result) => !result.allowed && result.reason === 'plan_exceeded').length, 1);
      assert.equal((await clients[0]!.companyOcrMonthlyUsage.findUniqueOrThrow({
        where: { companyId_monthKey: { companyId, monthKey } },
        select: { usedCount: true },
      })).usedCount, 15);
      assert.equal(await clients[0]!.companyOcrUsageEvent.count({ where: { companyId, monthKey } }), 1);
    } finally {
      if (companyId) await clients[0]!.company.deleteMany({ where: { id: companyId } });
      await Promise.all(clients.map((client) => client.$disconnect().catch(() => undefined)));
    }
  });
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

  it('records against the month pinned when budget admission began', async () => {
    const { prisma, transactions } = fakePrisma();

    await recordCompanyAiUsage(
      prisma,
      config,
      { companyId: 'co-1', sourceRoute: 'line-turn', monthKey: '2026-07' },
      [usage()],
    );

    assert.equal(transactions[0]![0]!.args.data[0].monthKey, '2026-07');
    assert.equal(transactions[0]![1]!.args.where.companyId_monthKey.monthKey, '2026-07');
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

describe('runWithCompanyAiBudgetAdmission', () => {
  it('refuses a concurrent company action until the admitted action finishes', async () => {
    const { prisma } = budgetPrisma({ spendSatang: 0 });
    const leases = new RedisRateLimitService({ redisUrl: '', isProduction: false } as any);
    let unblock!: () => void;
    let markStarted!: () => void;
    const blocked = new Promise<void>((resolve) => { unblock = resolve; });
    const started = new Promise<void>((resolve) => { markStarted = resolve; });

    const first = runWithCompanyAiBudgetAdmission(prisma, budgetConfig, leases, 'co-race', async () => {
      markStarted();
      await blocked;
      return 'first';
    });
    await started;

    const second = await runWithCompanyAiBudgetAdmission(prisma, budgetConfig, leases, 'co-race', async () => 'second');
    assert.equal(second.allowed, false);
    if (!second.allowed) assert.equal(second.reason, 'busy');

    unblock();
    assert.deepEqual(await first, { allowed: true, value: 'first' });
    assert.deepEqual(
      await runWithCompanyAiBudgetAdmission(prisma, budgetConfig, leases, 'co-race', async () => 'next'),
      { allowed: true, value: 'next' },
    );
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

describe('retryBusyAdmission', () => {
  const busy = { allowed: false as const, reason: 'busy' as const, retryAfterSeconds: 3 };
  const ok = { allowed: true as const, value: 42 };

  it('returns a non-busy outcome immediately, with or without a deadline', async () => {
    const sleeps: number[] = [];
    const record = (ms: number) => { sleeps.push(ms); return Promise.resolve(); };
    assert.deepEqual(await retryBusyAdmission(async () => ok, Date.now() + 5_000, record), ok);
    const exceeded = { allowed: false as const, reason: 'exceeded' as const };
    assert.deepEqual(await retryBusyAdmission(async () => exceeded, Date.now() + 5_000, record), exceeded);
    assert.equal(sleeps.length, 0, 'non-busy outcomes never wait');
  });

  it('without a deadline, busy fails fast exactly as before (the ledger drain path)', async () => {
    let attempts = 0;
    const decision = await retryBusyAdmission(async () => { attempts += 1; return busy; }, undefined, () => {
      throw new Error('must not sleep');
    });
    assert.deepEqual(decision, busy);
    assert.equal(attempts, 1);
  });

  it('retries a busy admission until it is allowed within the deadline', async () => {
    const sleeps: number[] = [];
    let attempts = 0;
    const decision = await retryBusyAdmission(
      async () => { attempts += 1; return attempts < 3 ? busy : ok; },
      Date.now() + 60_000,
      (ms) => { sleeps.push(ms); return Promise.resolve(); },
    );
    assert.deepEqual(decision, ok);
    assert.equal(attempts, 3);
    assert.equal(sleeps.length, 2);
    assert.ok(sleeps.every((ms) => ms > 0 && ms <= 1_200), 'polls are short and bounded');
  });

  it('returns the busy outcome once the deadline has passed', async () => {
    let attempts = 0;
    const decision = await retryBusyAdmission(async () => { attempts += 1; return busy; }, Date.now() - 1, () => {
      throw new Error('must not sleep past the deadline');
    });
    assert.deepEqual(decision, busy);
    assert.equal(attempts, 1);
  });
});

describe('admission lanes', () => {
  it('chat and media lanes acquire DIFFERENT leases; no lane keeps the legacy combined key', async () => {
    const keys: string[] = [];
    const rateLimits = {
      tryAcquireLease: async (_scope: string, key: string) => { keys.push(key); return { acquired: true, token: 't' }; },
      releaseLease: async () => undefined,
    } as any;
    const prisma = { client: {
      companyAiConfiguration: { findUnique: async () => null },
      platformAiBudgetConfig: { findUnique: async () => null },
      companyAiMonthlyUsage: { findUnique: async () => ({ costSatang: 0 }) },
    } } as any;
    const run = (lane?: 'chat' | 'media') =>
      runWithCompanyAiBudgetAdmission(prisma, config, rateLimits, 'co-lane', async () => 'ok', lane);
    __resetCompanyAiBudgetCache();
    await run('chat');
    await run('media');
    await run();
    assert.equal(keys.length, 3);
    assert.match(keys[0]!, /:chat$/);
    assert.match(keys[1]!, /:media$/);
    assert.ok(!keys[2]!.endsWith(':chat') && !keys[2]!.endsWith(':media'), 'legacy callers keep the combined lease');
    assert.equal(keys[0]!.replace(/:chat$/, ''), keys[2]!, 'lanes only SUFFIX the legacy key');
  });
});


/**
 * The caller must outlast the gateway, not race it.
 *
 * `/internal/ai/receipt-ocr` chains up to four provider calls at `DOCUMENT_OCR_TIMEOUT_MS` each
 * (read, understand, vision re-read, understand again) = 180s, while both API-side clients used to
 * abort at 120s. That abort returns AI_GATEWAY_UNREACHABLE, which on the web lane refunds the OCR
 * admission as a retryable failure AND — because `recordCompanyAiUsage` reads its numbers off the
 * response body that never arrived — writes no AiUsageEvent at all. Real provider spend then misses
 * BOTH meters, and the trial AI budget is calibrated from exactly those meters.
 */
describe('AI gateway timeout budget', () => {
  // `__dirname` (not import.meta): this package compiles as CommonJS.
  const appsRoot = join(__dirname, '..', '..', '..', '..', '..');
  const gatewaySource = readFileSync(
    join(appsRoot, 'ai-gateway/src/modules/line-ai/presentation/http/line-ai-internal.controller.ts'),
    'utf8',
  );

  it('waits strictly longer than the gateway chain worst case', () => {
    const worstCase = AI_RECEIPT_OCR_MAX_PROVIDER_CALLS * AI_DOCUMENT_OCR_TIMEOUT_MS;
    assert.equal(worstCase, 180_000, 'four provider calls at the document budget');
    assert.ok(
      AI_RECEIPT_OCR_CLIENT_TIMEOUT_MS > worstCase,
      `client ${AI_RECEIPT_OCR_CLIENT_TIMEOUT_MS}ms must exceed the ${worstCase}ms chain`,
    );
    assert.equal(AI_RECEIPT_OCR_CLIENT_TIMEOUT_MS, 195_000, '180s chain plus a 15s transport margin');
  });

  it('is the SAME constant the gateway budgets each provider call with', () => {
    // A gateway that quietly re-hardcodes its own number puts the two back out of step, and the
    // arithmetic above would keep passing while the real chain outgrew the real client.
    assert.match(gatewaySource, /const DOCUMENT_OCR_TIMEOUT_MS = AI_DOCUMENT_OCR_TIMEOUT_MS;/);
    assert.doesNotMatch(gatewaySource, /const DOCUMENT_OCR_TIMEOUT_MS = \d/);
  });

  it('is what BOTH receipt callers actually pass to AbortSignal', () => {
    for (const path of [
      'api/src/modules/expenses/infrastructure/receipt-ocr.client.ts',
      'api/src/modules/line-ai/infrastructure/ai-gateway.client.ts',
    ]) {
      const source = readFileSync(join(appsRoot, path), 'utf8');
      assert.match(source, /_TIMEOUT_MS = AI_RECEIPT_OCR_CLIENT_TIMEOUT_MS;/, path);
      assert.doesNotMatch(source, /(?:EXTRACT|RECEIPT_OCR)_TIMEOUT_MS = \d/, path);
    }
  });

  it('covers the bank statement route on the same rule, at its own chain depth', () => {
    // Two calls, not four (read then extract), so 105s rather than 195s — but the same rule, because
    // an early abort loses the same usage body. This route sits outside the plan slip ceiling, so
    // there is no admission to refund; the unmetered spend is identical either way.
    const worstCase = AI_BANK_STATEMENT_MAX_PROVIDER_CALLS * AI_DOCUMENT_OCR_TIMEOUT_MS;
    assert.equal(worstCase, 90_000);
    assert.ok(
      aiGatewayClientTimeoutMs(AI_BANK_STATEMENT_MAX_PROVIDER_CALLS) > worstCase,
      'the banking client must outlast its own chain',
    );

    const source = readFileSync(join(appsRoot, 'api/src/modules/banking/infrastructure/statement-ai-extract.client.ts'), 'utf8');
    assert.match(source, /EXTRACT_TIMEOUT_MS = aiGatewayClientTimeoutMs\(AI_BANK_STATEMENT_MAX_PROVIDER_CALLS\);/);
    assert.doesNotMatch(source, /EXTRACT_TIMEOUT_MS = \d/, 'a re-hardcoded number puts it back out of step');
  });

  it('leaves the four-call chain visible in the gateway, so the count cannot drift unnoticed', () => {
    const perCallBudgets = gatewaySource.match(/timeoutMs: DOCUMENT_OCR_TIMEOUT_MS/g) ?? [];
    assert.ok(perCallBudgets.length >= 3, 'read, extract and re-read providers all carry the budget');
  });
});
