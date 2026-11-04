import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AI_BANK_STATEMENT_MAX_PROVIDER_CALLS,
  AI_DOCUMENT_OCR_TIMEOUT_MS,
  AI_DOCUMENT_PAGE_TIMEOUT_MS,
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
  receiptQuotaSnapshot,
} from './company-ocr-governance';
import {
  __resetCompanyAiBudgetCache,
  invalidateCompanyAiBudgetConfiguration,
  assertCompanyAiBudget,
  bangkokMonthKey,
  classifyAiUsageRequest,
  companyAiBudgetRefusal,
  recordCompanyAiCostAdjustment,
  recordCompanyAiUsage,
  resolvePlatformAiBudget,
  retryBusyAdmission,
  runWithCompanyAiBudgetAdmission,
} from './company-ai-usage-meter';
import {
  nextBangkokMonthKey,
  resolveAiBudgetPolicy,
  type AiBudgetPendingPolicy,
  type CompanyAiBudgetPolicyRow,
} from './company-ai-budget-policy';
import { readAiBudgetReadiness } from './company-ai-budget-readiness';

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
  receiptQuotaEnforced?: boolean | null;
  limit?: number | null;
  used?: number;
  receiptUsed?: number;
  /** P10-L §15.1 plan ceiling. Absent = no `CompanyPlanTerm` row = grandfathered unlimited, which is
   *  what every ops-brake case below is, so none of their expectations move. */
  planTerm?: { tierKey: string; monthlySlipLimit: number; warmupUntil?: Date | null; warmupSlipLimit?: number | null } | null;
  enforceReceiptQuota?: boolean;
  auditedThisMonth?: boolean;
} = {}) {
  const auditWrites: any[] = [];
  const events: OcrEvent[] = [];
  let usedCount = input.used ?? 0;
  let eventSequence = 0;
  let queue = Promise.resolve();
  let lockCalls = 0;
  const lockKeys: string[] = [];
  const tx = {
    company: { findUnique: async () => null },
    billingReceiptGrant: { findMany: async () => [] },
    $executeRaw: async (_strings: TemplateStringsArray, key: string) => { lockCalls += 1; lockKeys.push(key); },
    companyOcrUsageEvent: {
      count: async () => (input.receiptUsed ?? input.used ?? 0) + events.filter((event) => event.sourceRoute !== 'bank-statement-extract').length,
      findUnique: async ({ where }: any) => {
        const key = where.companyId_sourceRoute_requestId;
        return events.find((event) => event.companyId === key.companyId
          && event.sourceRoute === key.sourceRoute && event.requestId === key.requestId) ?? null;
      },
      create: async ({ data }: any) => {
        const event = { id: `event-${++eventSequence}`, ...data };
        events.push(event);
        return event;
      },
      delete: async ({ where }: any) => {
        const index = events.findIndex((event) => event.id === where.id);
        return events.splice(index, 1)[0];
      },
    },
    companyAiConfiguration: {
      findUnique: async () => input.enabled === undefined && input.limit === undefined && input.receiptQuotaEnforced === undefined
        ? null
        : { ocrEnabled: input.enabled ?? true, ocrMonthlyLimit: input.limit ?? null, receiptQuotaEnforced: input.receiptQuotaEnforced },
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
      create: async ({ data }: any) => { auditWrites.push(data); return data; },
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
    assert.deepEqual(result, { allowed: true, eventId: 'event-1', monthKey: '2026-08', usedCount: 1, monthlyLimit: null });
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
    assert.equal(await releaseCompanyOcrAdmission(state.prisma, { ...baseOcrAdmission, eventId: state.events[0]!.id }), true);
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
    assert.equal(await releaseCompanyOcrAdmission(state.prisma, { ...baseOcrAdmission, eventId: state.events[0]!.id }), true);
    assert.equal(state.events.length, 0);
    assert.equal(state.usedCount(), 0);
    assert.equal((await admitCompanyOcr(state.prisma, baseOcrAdmission)).allowed, true);
  });

  it('fails closed and emits a compensation alert when every release attempt is exhausted', async () => {
    const state = fakeOcrPrisma();
    assert.equal((await admitCompanyOcr(state.prisma, baseOcrAdmission)).allowed, true);
    const warn = mock.method(Logger.prototype, 'warn', () => undefined);
    state.prisma.client.$transaction = async () => { throw new Error('DB_STILL_DOWN'); };

    assert.equal(await releaseCompanyOcrAdmission(state.prisma, { ...baseOcrAdmission, eventId: state.events[0]!.id }), false);
    assert.equal(state.events.length, 1, 'conservative quota remains when compensation cannot be proved');
    assert.equal(state.usedCount(), 1);
    assert.equal(warn.mock.calls.some((call) =>
      (call.arguments[0] as any)?.actionRequired === 'OCR_QUOTA_COMPENSATION_REQUIRED'
      && (call.arguments[0] as any)?.msg === 'ocr.quota.release_unavailable'
      && (call.arguments[0] as any)?.eventId === state.events[0]!.id
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
        eventId: (results[admittedIndex] as { eventId: string }).eventId,
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
  for (const override of [null, false, true]) for (const startup of [false, true]) {
    it(`uses the saved runtime override for both receipt lanes: override=${override}, startup=${startup}`, async () => {
      for (const sourceRoute of ['receipt-ocr-web', 'receipt-ocr-line'] as const) {
        const state = fakeOcrPrisma({ planTerm: FREE_TRIAL, used: 15, receiptQuotaEnforced: override });
        assert.equal((await admitCompanyOcr(state.prisma, { ...baseOcrAdmission, sourceRoute, enforceReceiptQuota: startup })).allowed, !(override ?? startup));
      }
    });
  }

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

  it('bank statement reads cannot spend the receipt allowance, while they still meet the ops brake', async () => {
    const state = fakeOcrPrisma({ planTerm: FREE_TRIAL, used: 50, receiptUsed: 14, limit: 100 });
    assert.equal((await admitCompanyOcr(state.prisma, enforced)).allowed, true, 'receipt fifteen remains available');
    const sixteenth = await admitCompanyOcr(state.prisma, { ...enforced, requestId: 'receipt-16' });
    assert.deepEqual(sixteenth, { allowed: false, reason: 'plan_exceeded', usedCount: 15, monthlyLimit: 15, tierKey: 'FREE_TRIAL_15' });
    assert.equal(state.usedCount(), 51, 'all retained routes remain in the operational aggregate');
    const ops = fakeOcrPrisma({ planTerm: FREE_TRIAL, used: 50, receiptUsed: 0, limit: 50 });
    assert.equal((await admitCompanyOcr(ops.prisma, enforced) as any).reason, 'exceeded');
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

  it('allows legacy warmup-10 trial rows their full stored monthly allowance immediately', async () => {
    const warmup = (warmupUntil: Date) => ({ ...FREE_TRIAL, warmupUntil, warmupSlipLimit: 10 });

    const inside = fakeOcrPrisma({ planTerm: warmup(new Date(Date.now() + 60_000)), used: 10 });
    assert.equal((await admitCompanyOcr(inside.prisma, enforced)).allowed, true, 'legacy warmup does not reduce the trial');

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
      await clients[0]!.companyOcrMonthlyUsage.create({ data: { companyId, monthKey, usedCount: 22 } });
      await clients[0]!.companyOcrUsageEvent.createMany({ data: Array.from({ length: 14 }, (_, n) => ({
        companyId, monthKey, sourceRoute: 'receipt-ocr-web', requestId: `seed-${n}`,
      })).concat(Array.from({ length: 8 }, (_, n) => ({ companyId, monthKey, sourceRoute: 'bank-statement-extract', requestId: `bank-${n}` }))) });

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
      })).usedCount, 23);
      assert.equal(await clients[0]!.companyOcrUsageEvent.count({ where: { companyId, monthKey } }), 23);
      assert.deepEqual(await receiptQuotaSnapshot({ client: clients[0] } as any, companyId, monthKey), { usedCount: 15, planLimit: 15, tierKey: 'FREE_TRIAL_15' });
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
  const events: any[] = [];
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
            events.push(...args.data);
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
  return { prisma: { client } as any, transactions, aggregate, events };
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

  // ── D1 metadata (remediation spec §11.2) ───────────────────────────────────

  it('stamps the server-derived kind/bucket, the reported basis, MODEL_CALL and a pricing snapshot', async () => {
    const { prisma, transactions } = fakePrisma();

    await recordCompanyAiUsage(
      prisma,
      config,
      { companyId: 'co-1', sourceRoute: 'line-intake-route', requestId: 'req-1', requestKind: 'IMAGE', budgetBucket: 'OCR' },
      [usage({ usageBasis: 'CONSERVATIVE_ESTIMATE' })],
    );

    const row = transactions[0]![0]!.args.data[0];
    assert.equal(row.requestKind, 'IMAGE');
    assert.equal(row.budgetBucket, 'OCR');
    assert.equal(row.usageBasis, 'CONSERVATIVE_ESTIMATE');
    assert.equal(row.eventKind, 'MODEL_CALL');
    assert.deepEqual(row.pricingSnapshot.usdPerMTok, { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 });
    assert.equal(row.pricingSnapshot.thbPerUsd, 33);
    assert.equal(row.pricingSnapshot.unknownModel, false);
  });

  it('meters a legacy-shaped entry with no basis and an untagged seam as UNKNOWN, not a guess', async () => {
    const { prisma, transactions } = fakePrisma();

    // An older gateway artifact reports no basis, and an older API seam passes no classification.
    await recordCompanyAiUsage(prisma, config, { companyId: 'co-1', sourceRoute: 'line-turn' }, [usage()]);

    const row = transactions[0]![0]!.args.data[0];
    assert.equal(row.usageBasis, null);
    assert.equal(row.requestKind, null);
    assert.equal(row.budgetBucket, null);
    assert.equal(row.costSatang, 347, 'the money is metered exactly as before');
    assert.deepEqual(transactions[0]![1]!.args.update.callCount, { increment: 1 }, 'the aggregate is unchanged');
  });

  it('refuses a basis the gateway response invented rather than storing wire text', async () => {
    const { prisma, transactions } = fakePrisma();

    await recordCompanyAiUsage(prisma, config, { companyId: 'co-1', sourceRoute: 'line-turn' },
      [usage({ usageBasis: "MEASURED'; DROP" as any })]);

    assert.equal(transactions[0]![0]!.args.data[0].usageBasis, null);
  });

  // ── Untrusted gateway payload (controller follow-up 5) ─────────────────────

  for (const [label, bad] of [
    ['a negative counter', { inputTokens: -1_000_000 }],
    ['NaN', { outputTokens: Number.NaN }],
    ['a float', { cacheReadInputTokens: 12.5 }],
    ['a numeric string', { cacheWriteInputTokens: '500' }],
    ['an unsafe integer', { inputTokens: Number.MAX_SAFE_INTEGER + 2 }],
    ['an empty modelId', { modelId: '' }],
    ['a missing tag', { tag: undefined }],
    ['a non-boolean ok', { ok: 'yes' }],
  ] as Array<[string, Record<string, unknown>]>) {
    it(`never prices or writes an entry with ${label}`, async () => {
      const { prisma, transactions } = fakePrisma();

      const spend = await recordCompanyAiUsage(prisma, config, { companyId: 'co-1', sourceRoute: 'line-turn', requestId: 'req-bad' }, [usage(bad as any)]);

      assert.equal(spend, undefined);
      assert.equal(transactions.length, 0, 'a malformed counter must never reach the aggregate');
      assert.deepEqual(warnings.filter((w) => w?.msg === 'ai.usage.malformed_entry'), [
        { msg: 'ai.usage.malformed_entry', sourceRoute: 'line-turn', requestId: 'req-bad', companyId: 'co-1' },
      ]);
      assert.equal(warnings.filter((w) => w?.msg === 'ai.usage.absent').length, 1, 'an all-bad batch behaves like an absent one');
    });
  }

  it('keeps the good entries of a mixed batch and drops only the malformed one', async () => {
    const { prisma, transactions } = fakePrisma();

    const spend = await recordCompanyAiUsage(prisma, config, { companyId: 'co-1', sourceRoute: 'line-turn', requestId: 'req-mixed' }, [
      usage({ inputTokens: -5 } as any),
      usage(),
    ]);

    assert.deepEqual(spend, { pre: 0, post: 347 }, 'only the good entry is billed');
    assert.equal(transactions[0]!.map((o) => o.op).length, 2);
    assert.equal(transactions[0]![0]!.args.data.length, 1, 'exactly one row is written');
    assert.deepEqual(transactions[0]![1]!.args.update.callCount, { increment: 1 });
    assert.equal(warnings.filter((w) => w?.msg === 'ai.usage.malformed_entry').length, 1);
    assert.equal(warnings.filter((w) => w?.msg === 'ai.usage.absent').length, 0);
  });

  for (const [label, entry] of [
    ['awkward fractions', usage({ inputTokens: 1, outputTokens: 3, cacheReadInputTokens: 7, cacheWriteInputTokens: 11 })],
    ['cache-only', usage({ inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 123_457, cacheWriteInputTokens: 1 })],
    ['zero counters', usage({ inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheWriteInputTokens: 0 })],
    ['unknown model at max price', usage({ modelId: 'some.unlisted-model-v9', inputTokens: 3, outputTokens: 5 })],
  ] as const) {
    it(`snapshot components sum exactly to costSatang — ${label}`, async () => {
      const { prisma, transactions } = fakePrisma();

      await recordCompanyAiUsage(prisma, config, { companyId: 'co-1', sourceRoute: 'line-turn' }, [entry]);

      const row = transactions[0]![0]!.args.data[0];
      const parts = row.pricingSnapshot.componentSatang;
      assert.equal(
        parts.input + parts.output + parts.cacheRead + parts.cacheWrite + parts.rounding,
        row.costSatang,
        'components plus the rounding term must reconstruct the authoritative money',
      );
    });
  }
});

describe('classifyAiUsageRequest', () => {
  const table: Array<[string, 'text' | 'image' | 'document', 'TEXT' | 'IMAGE' | 'OTHER', 'CHAT' | 'OCR']> = [
    ['line-turn', 'text', 'TEXT', 'CHAT'],
    // Attaching a picture to a chat turn must not move the turn's ERP reasoning onto the OCR budget.
    ['line-turn', 'image', 'IMAGE', 'CHAT'],
    ['line-turn', 'document', 'OTHER', 'CHAT'],
    ['line-intake-route', 'text', 'TEXT', 'CHAT'],
    // A LINE intake carrying a JPEG/PNG runs the governed image reader: the WHOLE call is OCR.
    ['line-intake-route', 'image', 'IMAGE', 'OCR'],
    ['receipt-ocr', 'image', 'IMAGE', 'OCR'],
    ['receipt-ocr', 'document', 'OTHER', 'OCR'],
    ['bank-statement-extract', 'image', 'IMAGE', 'OCR'],
    ['crm-summary', 'text', 'TEXT', 'CHAT'],
    ['crm-reply-draft', 'text', 'TEXT', 'CHAT'],
    ['draft-generate', 'text', 'TEXT', 'CHAT'],
  ];

  for (const [sourceRoute, content, requestKind, budgetBucket] of table) {
    it(`${sourceRoute} + ${content} → ${requestKind} / ${budgetBucket}`, () => {
      assert.deepEqual(classifyAiUsageRequest(sourceRoute, content), { requestKind, budgetBucket });
    });
  }

  it('never reads the usage tag: the intake image path is tagged line.intake-route', () => {
    // `usageTag.startsWith('ocr')` would classify this CHAT; the route + content say OCR.
    assert.equal(classifyAiUsageRequest('line-intake-route', 'image').budgetBucket, 'OCR');
    assert.equal(classifyAiUsageRequest('ocr-sounding-but-unknown-route', 'text').budgetBucket, 'CHAT');
  });
});

describe('recordCompanyAiCostAdjustment', () => {
  /** Minimal ledger fake: one original row, one aggregate, and the unique correctionKey fence. */
  function adjustmentPrisma(options: { aggregate?: Record<string, number>; eventKind?: string; usageBasis?: string } = {}) {
    const events = new Map<string, any>([['evt-1', {
      id: 'evt-1', companyId: 'co-1', monthKey: '2026-09', sourceRoute: 'line-turn', usageTag: 'line_turn',
      modelId: 'sonnet', thbPerUsd: 33, thbPerUsdSource: 'env-fallback', requestKind: 'TEXT', budgetBucket: 'CHAT',
      usageBasis: options.usageBasis ?? 'PROVIDER_REPORTED', requestId: 'req-1', eventKind: options.eventKind ?? 'MODEL_CALL',
    }]]);
    const aggregate: Record<string, number> = {
      costSatang: 1_000, callCount: 3, inputTokens: 100, outputTokens: 100,
      cacheReadInputTokens: 100, cacheWriteInputTokens: 100, ...options.aggregate,
    };
    const created: any[] = [];
    const client = {
      $transaction: async (fn: (tx: any) => Promise<any>) => fn({
        aiUsageEvent: {
          findUnique: async (args: any) => args.where.correctionKey !== undefined
            ? created.find((row) => row.correctionKey === args.where.correctionKey) ?? null
            : events.get(args.where.id) ?? null,
          create: async (args: any) => { created.push(args.data); return args.data; },
        },
        companyAiMonthlyUsage: {
          updateMany: async (args: any) => {
            const blocked = Object.entries(args.where)
              .filter(([, value]) => typeof value === 'object' && value !== null && 'gte' in (value as any))
              .some(([field, value]) => aggregate[field]! < (value as any).gte);
            if (blocked) return { count: 0 };
            for (const [field, value] of Object.entries(args.data)) aggregate[field] = aggregate[field]! + (value as any).increment;
            return { count: 1 };
          },
        },
      }),
    };
    return { prisma: { client } as any, aggregate, created };
  }

  it('keeps corrections to absorbed company cost out of every customer aggregate', async () => {
    const { prisma, aggregate, created } = adjustmentPrisma({ usageBasis: 'COMPANY_ABSORBED' });
    const before = structuredClone(aggregate);
    const correction = { eventId: 'evt-1', correctionKey: 'internal-adjustment', costSatang: -120 };
    assert.equal(await recordCompanyAiCostAdjustment(prisma, correction), 'applied');
    assert.equal(await recordCompanyAiCostAdjustment(prisma, correction), 'duplicate');
    assert.deepEqual(aggregate, before);
    assert.equal(created[0].usageBasis, 'COMPANY_ABSORBED');
    assert.equal(created[0].costSatang, -120);
  });

  it('moves cost and tokens on the original month without touching callCount', async () => {
    const { prisma, aggregate, created } = adjustmentPrisma();

    const outcome = await recordCompanyAiCostAdjustment(prisma, {
      eventId: 'evt-1', correctionKey: 'settle-1', costSatang: -120, inputTokens: -40,
    });

    assert.equal(outcome, 'applied');
    assert.equal(aggregate.costSatang, 880);
    assert.equal(aggregate.inputTokens, 60);
    assert.equal(aggregate.callCount, 3, 'a correction is never a provider call');
    assert.equal(created[0].eventKind, 'COST_ADJUSTMENT');
    assert.equal(created[0].adjustsEventId, 'evt-1');
    assert.equal(created[0].monthKey, '2026-09', 'the ORIGINAL month absorbs the delta');
    assert.equal(created[0].pricingSnapshot, null, 'an adjustment carries no new priced evidence');
  });

  it('is idempotent on the correction identity', async () => {
    const { prisma, aggregate, created } = adjustmentPrisma();
    const correction = { eventId: 'evt-1', correctionKey: 'settle-1', costSatang: -120 };

    assert.equal(await recordCompanyAiCostAdjustment(prisma, correction), 'applied');
    assert.equal(await recordCompanyAiCostAdjustment(prisma, correction), 'duplicate');
    assert.equal(aggregate.costSatang, 880, 'a replayed correction applies once');
    assert.equal(created.length, 1);
  });

  it('refuses a delta that would drive an aggregate negative, and writes nothing', async () => {
    const { prisma, aggregate, created } = adjustmentPrisma();

    assert.equal(
      await recordCompanyAiCostAdjustment(prisma, { eventId: 'evt-1', correctionKey: 'settle-2', costSatang: -1_001 }),
      'refused-negative',
    );
    assert.equal(aggregate.costSatang, 1_000);
    assert.equal(created.length, 0);
  });

  /** The exact P2002 shape Prisma 7's pg adapter produced against real PostgreSQL — note the
   *  QUOTED column name and the absent `meta.target`. Pinned so an adapter upgrade cannot
   *  silently turn a concurrent replay back into a thrown 500. */
  const adapterP2002 = (field: string) => Object.assign(new Error('Unique constraint failed'), {
    code: 'P2002',
    meta: {
      modelName: 'AiUsageEvent',
      driverAdapterError: {
        name: 'DriverAdapterError',
        cause: { originalCode: '23505', kind: 'UniqueConstraintViolation', constraint: { fields: [`"${field}"`] } },
      },
    },
  });

  it('reports a LOST unique-index race as duplicate, not as a thrown error', async () => {
    const { prisma, aggregate } = adjustmentPrisma();
    const base = prisma.client.$transaction;
    // The findUnique saw nothing (the winner had not committed yet); the INSERT loses the race.
    prisma.client.$transaction = (fn: any) => base((tx: any) => fn({
      ...tx, aiUsageEvent: { ...tx.aiUsageEvent, create: async () => { throw adapterP2002('correctionKey'); } },
    }));

    assert.equal(
      await recordCompanyAiCostAdjustment(prisma, { eventId: 'evt-1', correctionKey: 'race', costSatang: -120 }),
      'duplicate',
    );
    assert.equal(aggregate.costSatang, 880, 'the fake cannot roll back, but the real transaction does');
  });

  it('still propagates a unique violation on any OTHER constraint', async () => {
    const { prisma } = adjustmentPrisma();
    const base = prisma.client.$transaction;
    prisma.client.$transaction = (fn: any) => base((tx: any) => fn({
      ...tx, aiUsageEvent: { ...tx.aiUsageEvent, create: async () => { throw adapterP2002('requestId'); } },
    }));

    await assert.rejects(
      () => recordCompanyAiCostAdjustment(prisma, { eventId: 'evt-1', correctionKey: 'k', costSatang: -1 }),
      { code: 'P2002' },
    );
  });

  it('refuses an unknown event and refuses to correct a correction', async () => {
    const missing = adjustmentPrisma();
    assert.equal(
      await recordCompanyAiCostAdjustment(missing.prisma, { eventId: 'nope', correctionKey: 'k1', costSatang: -1 }),
      'unknown-event',
    );
    const chained = adjustmentPrisma({ eventKind: 'COST_ADJUSTMENT' });
    assert.equal(
      await recordCompanyAiCostAdjustment(chained.prisma, { eventId: 'evt-1', correctionKey: 'k2', costSatang: -1 }),
      'unknown-event',
    );
    assert.equal(chained.aggregate.costSatang, 1_000);
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

  it('reads a changed company budget before every admission without a local invalidation', async () => {
    const options={monthlyBudgetSatang:90_000,spendSatang:50_000};
    const {prisma,reads}=budgetPrisma(options);
    assert.deepEqual(await assertCompanyAiBudget(prisma,budgetConfig,'co-fresh'),{allowed:true});
    options.monthlyBudgetSatang=40_000;
    const reduced=await assertCompanyAiBudget(prisma,budgetConfig,'co-fresh');
    assert.equal(reduced.allowed,false);if(!reduced.allowed)assert.equal(reduced.reason,'exceeded');
    options.monthlyBudgetSatang=100_000;
    assert.deepEqual(await assertCompanyAiBudget(prisma,budgetConfig,'co-fresh'),{allowed:true});
    assert.equal(reads.budget,3);
  });

  it('uses a changed inherited platform budget without clearing any process cache', async () => {
    const {prisma}=budgetPrisma({monthlyBudgetSatang:null,spendSatang:50_000});
    let budget=90_000;
    prisma.client.platformAiBudgetConfig={findUnique:async()=>({monthlyBudgetSatang:budget,ceilingSatang:100_000})};
    assert.deepEqual(await assertCompanyAiBudget(prisma,budgetConfig,'co-inherited-fresh'),{allowed:true});
    budget=40_000;
    const denied=await assertCompanyAiBudget(prisma,budgetConfig,'co-inherited-fresh');
    assert.equal(denied.allowed,false);if(!denied.allowed){assert.equal(denied.reason,'exceeded');}
    budget=100_000;
    assert.deepEqual(await assertCompanyAiBudget(prisma,budgetConfig,'co-inherited-fresh'),{allowed:true});
  });

  it('reads spend live on every call, so a fresh increment is seen immediately', async () => {
    const { prisma, reads, setSpend } = budgetPrisma({ monthlyBudgetSatang: 10_000, spendSatang: 9_999 });

    assert.deepEqual(await assertCompanyAiBudget(prisma, budgetConfig, 'co-live'), { allowed: true });
    setSpend(10_000);
    const second = await assertCompanyAiBudget(prisma, budgetConfig, 'co-live');

    assert.equal(second.allowed, false, 'the spend meter is the one value that must never be stale');
    assert.equal(reads.spend, 2);
    assert.equal(reads.budget, 2, 'current configuration and spend both govern admission');
  });

  it('treats a missing aggregate row as zero spend', async () => {
    const { prisma } = budgetPrisma({ monthlyBudgetSatang: 1 });
    assert.deepEqual(await assertCompanyAiBudget(prisma, budgetConfig, 'co-no-aggregate'), { allowed: true });
  });
});

describe('runWithCompanyAiBudgetAdmission', () => {
  it('a configuration invalidation keeps an already admitted local action locked', async () => {
    const {prisma}=budgetPrisma({spendSatang:0});
    let release!:()=>void,started!:()=>void;
    const held=new Promise<void>(resolve=>{release=resolve;}),ready=new Promise<void>(resolve=>{started=resolve;});
    const first=runWithCompanyAiBudgetAdmission(prisma,budgetConfig,undefined,'co-local-config',async()=>{started();await held;return 'first';});
    await ready;
    try {
      invalidateCompanyAiBudgetConfiguration();
      const second=await runWithCompanyAiBudgetAdmission(prisma,budgetConfig,undefined,'co-local-config',async()=> 'unexpected');
      assert.equal(second.allowed,false);if(!second.allowed)assert.equal(second.reason,'busy');
    }finally{release();await first;}
    assert.deepEqual(await runWithCompanyAiBudgetAdmission(prisma,budgetConfig,undefined,'co-local-config',async()=> 'next'),{allowed:true,value:'next'});
  });

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
 * `/internal/ai/receipt-ocr` chains up to eight provider calls at the 90s page ceiling each
 * (read, understand, vision re-read, understand again, plus four timeout retries), while clients used to
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
    const worstCase = AI_RECEIPT_OCR_MAX_PROVIDER_CALLS * AI_DOCUMENT_PAGE_TIMEOUT_MS;
    assert.equal(worstCase, 720_000, 'eight provider calls at the page budget');
    assert.ok(
      AI_RECEIPT_OCR_CLIENT_TIMEOUT_MS > worstCase,
      `client ${AI_RECEIPT_OCR_CLIENT_TIMEOUT_MS}ms must exceed the ${worstCase}ms chain`,
    );
    assert.equal(AI_RECEIPT_OCR_CLIENT_TIMEOUT_MS, 735_000, '720s chain plus a 15s transport margin');
  });

  it('is the SAME constant the gateway budgets each provider call with', () => {
    // A gateway that quietly re-hardcodes its own number puts the two back out of step, and the
    // arithmetic above would keep passing while the real chain outgrew the real client.
    assert.match(gatewaySource, /const DOCUMENT_OCR_TIMEOUT_MS = AI_DOCUMENT_OCR_TIMEOUT_MS;/);
    assert.doesNotMatch(gatewaySource, /const DOCUMENT_OCR_TIMEOUT_MS = \d/);
    assert.equal(AI_DOCUMENT_OCR_TIMEOUT_MS, 45_000, 'ordinary photos retain their shorter budget');
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
    // Read, one timeout retry, then extract, each bounded by the 90s page ceiling. The same rule applies because
    // an early abort loses the same usage body. This route sits outside the plan slip ceiling, so
    // there is no admission to refund; the unmetered spend is identical either way.
    const worstCase = AI_BANK_STATEMENT_MAX_PROVIDER_CALLS * AI_DOCUMENT_PAGE_TIMEOUT_MS;
    assert.equal(worstCase, 270_000);
    assert.ok(
      aiGatewayClientTimeoutMs(AI_BANK_STATEMENT_MAX_PROVIDER_CALLS) > worstCase,
      'the banking client must outlast its own chain',
    );

    const source = readFileSync(join(appsRoot, 'api/src/modules/banking/infrastructure/statement-ai-extract.client.ts'), 'utf8');
    assert.match(source, /EXTRACT_TIMEOUT_MS = aiGatewayClientTimeoutMs\(AI_BANK_STATEMENT_MAX_PROVIDER_CALLS\);/);
    assert.doesNotMatch(source, /EXTRACT_TIMEOUT_MS = \d/, 'a re-hardcoded number puts it back out of step');
  });

  it('uses work-sized shared budgets for receipt extraction and document reading', () => {
    assert.match(gatewaySource, /createProvider\(this.config, \{ modelId: extractionModelId, timeoutMs: image.timeoutMs \}\)/);
    assert.match(gatewaySource, /timeoutMs: image\?\.timeoutMs \?\? AI_DOCUMENT_PAGE_TIMEOUT_MS/);
    const mediaSource = readFileSync(join(appsRoot, 'ai-gateway/src/modules/line-ai/domain/logic/document-media.logic.ts'), 'utf8');
    assert.match(mediaSource, /aiDocumentOcrTimeoutMs\(\{ \.\.\.image, width, height \}\)/);
  });
});

// ── Split CHAT/OCR budget policy (remediation spec §12.1/§12.5, ADR 0013) ────────────

const policyRow = (over: Partial<CompanyAiBudgetPolicyRow> = {}): CompanyAiBudgetPolicyRow => ({
  budgetMode: 'SHARED', chatMonthlyBudgetSatang: null, ocrMonthlyBudgetSatang: null,
  budgetConfigVersion: 0, pendingBudgetPolicy: null, ...over,
});
const resolve = (row: CompanyAiBudgetPolicyRow | null | undefined, monthKey = '2026-09', totalSatang = 100) =>
  resolveAiBudgetPolicy({ row, totalSatang, override: false, monthKey });
const pending = (over: Partial<AiBudgetPendingPolicy> = {}): AiBudgetPendingPolicy => ({
  mode: 'SPLIT', chatMonthlyBudgetSatang: 30, ocrMonthlyBudgetSatang: 70, effectiveMonthKey: '2026-10', ...over,
});

describe('resolveAiBudgetPolicy', () => {
  it('resolves every company that exists today — and every pre-column test fake — as SHARED', () => {
    for (const row of [null, undefined, {}, policyRow(), { monthlyBudgetSatang: 500 } as CompanyAiBudgetPolicyRow]) {
      const policy = resolve(row);
      assert.deepEqual(
        { mode: policy.mode, source: policy.source, pending: policy.pending, invalidReason: policy.invalidReason },
        { mode: 'SHARED', source: 'ACTIVE', pending: null, invalidReason: undefined },
      );
    }
  });

  it('under SHARED the chat column is the chat credit an admin set; OCR stays inside the total', () => {
    const policy = resolve(policyRow({ chatMonthlyBudgetSatang: 30, ocrMonthlyBudgetSatang: 70 }));
    assert.equal(policy.mode, 'SHARED');
    assert.equal(policy.invalidReason, undefined, 'C+O is not validated under SHARED');
    assert.deepEqual([policy.chatCapSatang, policy.ocrCapSatang, policy.chatSource], [30, 70, 'ADMIN']);
    // Admin tab rework 2026-09-29: a TOTAL override is the safety ceiling only, never the chat credit.
    const ceilingOnly = resolveAiBudgetPolicy({ row: policyRow({ monthlyBudgetSatang: 50_000 }), totalSatang: 50_000, override: true, monthKey: '2026-09' });
    assert.deepEqual([ceilingOnly.chatCapSatang, ceilingOnly.chatSource], [8000, 'DEFAULT']);
    assert.deepEqual([resolve(policyRow()).chatCapSatang, resolve(policyRow()).chatSource], [8000, 'DEFAULT']);
  });

  it('expires a one-time sales credit with its paid deal term', () => {
    const row = policyRow({ salesDealChatCreditSatang: 12_000,
      salesDealChatCreditEndsAt: new Date('2026-10-23T03:00:00.000Z') });
    assert.equal(resolveAiBudgetPolicy({ row, totalSatang: 30_000, override: false, monthKey: '2026-10',
      at: new Date('2026-10-23T02:59:59.000Z') }).chatCapSatang, 12_000);
    assert.equal(resolveAiBudgetPolicy({ row, totalSatang: 30_000, override: false, monthKey: '2026-10',
      at: new Date('2026-10-23T03:00:00.000Z') }).chatCapSatang, 8_000);
  });

  it('spec §12.1 example T=100 C=30 O=70: an active SPLIT exposes both caps and stays valid at exactly T', () => {
    const policy = resolve(policyRow({ budgetMode: 'SPLIT', chatMonthlyBudgetSatang: 30, ocrMonthlyBudgetSatang: 70 }));
    assert.deepEqual(
      { mode: policy.mode, chat: policy.chatCapSatang, ocr: policy.ocrCapSatang, invalid: policy.invalidReason },
      { mode: 'SPLIT', chat: 30, ocr: 70, invalid: undefined },
    );
  });

  it('treats 0 as a closed bucket, not as "unset"', () => {
    const policy = resolve(policyRow({ budgetMode: 'SPLIT', chatMonthlyBudgetSatang: 0, ocrMonthlyBudgetSatang: 100 }));
    assert.equal(policy.invalidReason, undefined);
    assert.equal(policy.chatCapSatang, 0);
  });

  it('a FUTURE pending policy changes nothing yet and is reported separately', () => {
    const policy = resolve(policyRow({ pendingBudgetPolicy: pending() }), '2026-09');
    assert.equal(policy.mode, 'SHARED', 'the company is still SHARED until October');
    assert.equal(policy.source, 'ACTIVE');
    assert.deepEqual(policy.pending, pending());
  });

  it('a pending policy whose month has ARRIVED is the effective policy — no cron, the month keys decide', () => {
    for (const monthKey of ['2026-10', '2026-11']) {
      const policy = resolve(policyRow({ pendingBudgetPolicy: pending() }), monthKey);
      assert.deepEqual(
        { mode: policy.mode, chat: policy.chatCapSatang, ocr: policy.ocrCapSatang, source: policy.source, pending: policy.pending },
        { mode: 'SPLIT', chat: 30, ocr: 70, source: 'PENDING_ACTIVATED', pending: null },
      );
    }
  });

  it('R-07: the revision moves when the month turns, even though the row version never did', () => {
    const row = policyRow({ pendingBudgetPolicy: pending() });
    assert.equal(resolve(row, '2026-09').revision, '0:2026-09:ACTIVE');
    assert.equal(resolve(row, '2026-10').revision, '0:2026-10:PENDING_ACTIVATED');
    assert.notEqual(resolve(row, '2026-09').revision, resolve(row, '2026-10').revision);
    // And a plain month rollover without any pending policy still re-fences an open page.
    assert.notEqual(resolve(policyRow(), '2026-09').revision, resolve(policyRow(), '2026-10').revision);
    assert.equal(resolve(policyRow({ budgetConfigVersion: 4 })).revision, '4:2026-09:ACTIVE');
  });

  for (const [name, row, reason] of [
    ['SPLIT with one cap never set', policyRow({ budgetMode: 'SPLIT', chatMonthlyBudgetSatang: 30 }), 'SPLIT_CAPS_MISSING'],
    ['SPLIT with neither cap set', policyRow({ budgetMode: 'SPLIT' }), 'SPLIT_CAPS_MISSING'],
    ['C + O above the live total', policyRow({ budgetMode: 'SPLIT', chatMonthlyBudgetSatang: 31, ocrMonthlyBudgetSatang: 70 }), 'SPLIT_EXCEEDS_TOTAL'],
    ['a negative cap', policyRow({ budgetMode: 'SPLIT', chatMonthlyBudgetSatang: -1, ocrMonthlyBudgetSatang: 10 }), 'POLICY_MALFORMED'],
    ['a fractional cap', policyRow({ budgetMode: 'SPLIT', chatMonthlyBudgetSatang: 1.5, ocrMonthlyBudgetSatang: 10 }), 'POLICY_MALFORMED'],
    ['a mode nothing understands', policyRow({ budgetMode: 'HALF' }), 'POLICY_MALFORMED'],
    ['pending JSON that is not an object', policyRow({ pendingBudgetPolicy: 'SPLIT' }), 'POLICY_MALFORMED'],
    ['pending JSON missing its month', policyRow({ pendingBudgetPolicy: { mode: 'SPLIT', chatMonthlyBudgetSatang: 1, ocrMonthlyBudgetSatang: 1 } }), 'POLICY_MALFORMED'],
    ['pending JSON with a bad month', policyRow({ pendingBudgetPolicy: pending({ effectiveMonthKey: '2026-13' }) }), 'POLICY_MALFORMED'],
    ['an activated pending policy that no longer fits the total', policyRow({ pendingBudgetPolicy: pending({ chatMonthlyBudgetSatang: 60, effectiveMonthKey: '2026-09' }) }), 'SPLIT_EXCEEDS_TOTAL'],
  ] as const) {
    it(`fails closed on ${name} with ${reason}, never by clamping`, () => {
      const policy = resolve(row);
      assert.equal(policy.invalidReason, reason);
    });
  }
});

describe('assertCompanyAiBudget split policy gate', () => {
  const withPolicy = (row: CompanyAiBudgetPolicyRow & { monthlyBudgetSatang?: number | null }) => ({
    client: {
      companyAiConfiguration: { findUnique: async () => row },
      companyAiMonthlyUsage: { findUnique: async () => ({ costSatang: 0 }) },
    },
  } as any);

  it('stops CHAT at 80 credit without blocking OCR under the shared total', async () => {
    const prisma = { client: {
      companyAiConfiguration: { findUnique: async () => null },
      companyAiMonthlyUsage: { findUnique: async () => ({ costSatang: 8_000 }) },
      companyAiMonthlyBucketUsage: { findUnique: async () => ({ costSatang: 8_000 }) },
    } } as any;
    const chat = await assertCompanyAiBudget(prisma, budgetConfig, 'co-chat', bangkokMonthKey(),
      { budgetBucket: 'CHAT' } as any);
    assert.deepEqual(chat, { allowed: false, reason: 'exceeded', spendSatang: 8_000,
      budgetSatang: 8_000, override: false, budgetScope: 'CHAT' });
    assert.deepEqual(await assertCompanyAiBudget(prisma, budgetConfig, 'co-chat', bangkokMonthKey(),
      { budgetBucket: 'OCR' } as any), { allowed: true });
  });

  it('an admin chat credit wins over a newer deal credit; a TOTAL override alone does not', async () => {
    const withRow = (row: Record<string, unknown>) => ({ client: {
      companyAiConfiguration: { findUnique: async () => row },
      companyAiMonthlyUsage: { findUnique: async () => ({ costSatang: 12_000 }) },
      companyAiMonthlyBucketUsage: { findUnique: async () => ({ costSatang: 12_000 }) },
    } } as any);
    // Migration 20260929200000 holds a legacy TOTAL override as the SHARED chat credit.
    const admin = withRow({ monthlyBudgetSatang: 30_000, chatMonthlyBudgetSatang: 30_000, salesDealChatCreditSatang: 12_000 });
    assert.deepEqual(await assertCompanyAiBudget(admin, budgetConfig, 'co-deal', bangkokMonthKey(),
      { budgetBucket: 'CHAT' } as any), { allowed: true });
    assert.deepEqual(await assertCompanyAiBudget(admin, budgetConfig, 'co-deal', bangkokMonthKey(),
      { budgetBucket: 'OCR' } as any), { allowed: true });
    const ceilingOnly = withRow({ monthlyBudgetSatang: 30_000, salesDealChatCreditSatang: 12_000 });
    assert.deepEqual(await assertCompanyAiBudget(ceilingOnly, budgetConfig, 'co-deal', bangkokMonthKey(),
      { budgetBucket: 'CHAT' } as any), { allowed: false, reason: 'exceeded', spendSatang: 12_000,
      budgetSatang: 12_000, override: true, budgetScope: 'CHAT' });
    assert.deepEqual(await assertCompanyAiBudget(ceilingOnly, budgetConfig, 'co-deal', bangkokMonthKey(),
      { budgetBucket: 'OCR' } as any), { allowed: true }, 'the safety ceiling still has room for OCR');
  });

  it('uses the sales credit when there is no operator override', async () => {
    const prisma = { client: {
      companyAiConfiguration: { findUnique: async () => ({ monthlyBudgetSatang: null,
        salesDealChatCreditSatang: 12_000 }) },
      companyAiMonthlyUsage: { findUnique: async () => ({ costSatang: 12_000 }) },
      companyAiMonthlyBucketUsage: { findUnique: async () => ({ costSatang: 12_000 }) },
    } } as any;
    assert.deepEqual(await assertCompanyAiBudget(prisma, budgetConfig, 'co-deal', bangkokMonthKey(),
      { budgetBucket: 'CHAT' } as any), { allowed: false, reason: 'exceeded', spendSatang: 12_000,
      budgetSatang: 12_000, override: true, budgetScope: 'CHAT' });
  });

  it('leaves the SHARED path byte-for-byte: a fake with none of the new columns still admits', async () => {
    const { prisma } = budgetPrisma({ monthlyBudgetSatang: 10_000, spendSatang: 0 });
    assert.deepEqual(await assertCompanyAiBudget(prisma, budgetConfig, 'co-legacy-fake'), { allowed: true });
  });

  it('refuses a SPLIT company as unavailable — the shared overshoot path cannot honour a bucket cap', async () => {
    const prisma = withPolicy({ monthlyBudgetSatang: 100, budgetMode: 'SPLIT', chatMonthlyBudgetSatang: 30, ocrMonthlyBudgetSatang: 70 });
    assert.deepEqual(await assertCompanyAiBudget(prisma, budgetConfig, 'co-split'), { allowed: false, reason: 'unavailable' });
  });

  it('refuses an ACTIVATED pending SPLIT the same way, without any config write having happened', async () => {
    const prisma = withPolicy({ monthlyBudgetSatang: 100, pendingBudgetPolicy: pending({ effectiveMonthKey: bangkokMonthKey() }) });
    assert.deepEqual(await assertCompanyAiBudget(prisma, budgetConfig, 'co-activated'), { allowed: false, reason: 'unavailable' });
  });

  it('still admits a company whose pending SPLIT is only scheduled for next month', async () => {
    const prisma = withPolicy({ monthlyBudgetSatang: 100, pendingBudgetPolicy: pending({ effectiveMonthKey: nextBangkokMonthKey() }) });
    assert.deepEqual(await assertCompanyAiBudget(prisma, budgetConfig, 'co-scheduled'), { allowed: true });
  });

  for (const [name, row] of [
    ['an unreadable policy', { budgetMode: 'SPLIT', chatMonthlyBudgetSatang: null, ocrMonthlyBudgetSatang: 70 }],
    ['malformed pending JSON', { pendingBudgetPolicy: { mode: 'NOPE' } }],
    ['an allocation above the total', { budgetMode: 'SPLIT', chatMonthlyBudgetSatang: 90, ocrMonthlyBudgetSatang: 90 }],
  ] as const) {
    it(`refuses ${name} as unavailable rather than passing it as SHARED`, async () => {
      const prisma = withPolicy({ monthlyBudgetSatang: 100, ...row });
      assert.deepEqual(await assertCompanyAiBudget(prisma, budgetConfig, `co-${name}`), { allowed: false, reason: 'unavailable' });
    });
  }
});

// Owner 2026-09-30 ("ข้อความตอนเครดิตหมดระหว่างส่งซ้ำ ต้องยอมให้ใช้เกินโควต้า"): the LINE ledger drain's
// retry of a turn passes the cap; only the two cap comparisons yield.
describe('admitOverCap — the LINE ledger drain retry', () => {
  const drainStep = (over: Record<string, unknown> = {}) => ({ budgetBucket: 'CHAT', admitOverCap: true, ...over }) as any;
  /** SHARED: TOTAL 10,000 with an admin chat credit of 8,000. */
  const shared = (spend: number, chatSpend: number, over: Record<string, unknown> = {}) => ({ client: {
    companyAiConfiguration: { findUnique: async () => ({ monthlyBudgetSatang: 10_000, chatMonthlyBudgetSatang: 8_000 }) },
    companyAiMonthlyUsage: { findUnique: async () => ({ costSatang: spend }) },
    companyAiMonthlyBucketUsage: { findUnique: async () => ({ costSatang: chatSpend }) },
    ...over,
  } } as any);

  it('admits past the TOTAL and the CHAT cap and logs it, with no exceeded event', async () => {
    assert.deepEqual(await assertCompanyAiBudget(shared(10_000, 8_000), budgetConfig, 'co-drain', bangkokMonthKey(), drainStep()),
      { allowed: true });
    assert.deepEqual(warnings.filter((w) => w?.msg === 'ai.budget.admitted_over_cap').map((w) => w.budgetScope), ['TOTAL', 'CHAT']);
    assert.equal(warnings.filter((w) => w?.msg === 'ai.company_budget.exceeded').length, 0);
  });

  it('the live path (no admitOverCap) still refuses at the same spend', async () => {
    const live = drainStep({ admitOverCap: undefined });
    const total = await assertCompanyAiBudget(shared(10_000, 8_000), budgetConfig, 'co-live', bangkokMonthKey(), live);
    assert.equal(total.allowed, false);
    if (!total.allowed) assert.equal(total.reason, 'exceeded');
    assert.deepEqual(await assertCompanyAiBudget(shared(8_000, 8_000), budgetConfig, 'co-live', bangkokMonthKey(), live),
      { allowed: false, reason: 'exceeded', spendSatang: 8_000, budgetSatang: 8_000, override: true, budgetScope: 'CHAT' });
  });

  it('keeps every other refusal: an unreadable meter or CHAT row, an invalid policy, a busy lease', async () => {
    const throwing = { findUnique: async () => { throw new Error('DB_DOWN'); } };
    assert.deepEqual(await assertCompanyAiBudget(shared(0, 0, { companyAiMonthlyUsage: throwing }), budgetConfig, 'co-meter-down',
      bangkokMonthKey(), drainStep()), { allowed: false, reason: 'unavailable' });
    assert.deepEqual(await assertCompanyAiBudget(shared(0, 0, { companyAiMonthlyBucketUsage: throwing }), budgetConfig, 'co-chat-down',
      bangkokMonthKey(), drainStep()), { allowed: false, reason: 'unavailable', budgetScope: 'CHAT' });
    const invalid = shared(0, 0, { companyAiConfiguration: { findUnique: async () => ({
      monthlyBudgetSatang: 100, budgetMode: 'SPLIT', chatMonthlyBudgetSatang: 90, ocrMonthlyBudgetSatang: 90 }) } });
    assert.deepEqual(await assertCompanyAiBudget(invalid, budgetConfig, 'co-invalid', bangkokMonthKey(), drainStep()),
      { allowed: false, reason: 'unavailable' });

    let release!: () => void;
    let started!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const ready = new Promise<void>((resolve) => { started = resolve; });
    const first = runWithCompanyAiBudgetAdmission(shared(0, 0), budgetConfig, undefined, 'co-drain-busy',
      async () => { started(); await held; return 'first'; }, 'chat');
    await ready;
    try {
      const retry = await runWithCompanyAiBudgetAdmission(shared(10_000, 8_000), budgetConfig, undefined, 'co-drain-busy',
        async () => 'unexpected', 'chat', drainStep());
      assert.equal(retry.allowed, false);
      if (!retry.allowed) assert.equal(retry.reason, 'busy');
    } finally { release(); await first; }
  });

  // Owner 2026-09-30 ("ไม่ทำต่อ"): an admin's explicit closure — a cap of 0 — wins over every over-cap admission.
  it('never passes a cap of 0: an admin-closed chat credit, or a total of 0, still refuses', async () => {
    const closedChat = shared(0, 0, { companyAiConfiguration: { findUnique: async () => ({ monthlyBudgetSatang: 10_000, chatMonthlyBudgetSatang: 0 }) } });
    assert.deepEqual(await assertCompanyAiBudget(closedChat, budgetConfig, 'co-closed-chat', bangkokMonthKey(), drainStep()),
      { allowed: false, reason: 'exceeded', spendSatang: 0, budgetSatang: 0, override: true, budgetScope: 'CHAT' });
    const zeroTotal = shared(0, 0, { companyAiConfiguration: { findUnique: async () => null } });
    const total = await assertCompanyAiBudget(zeroTotal, { ...budgetConfig, aiMonthlyBudgetSatang: 0 }, 'co-zero-total', bangkokMonthKey(),
      drainStep({ budgetBucket: 'OCR' }));
    assert.equal(total.allowed, false);
    if (!total.allowed) assert.equal(total.reason, 'exceeded');
    assert.equal(warnings.filter((w) => w?.msg === 'ai.budget.admitted_over_cap').length, 0);
  });

  it('runs the action under the lease over the cap, so its caller meters it like any turn', async () => {
    assert.deepEqual(await runWithCompanyAiBudgetAdmission(shared(10_000, 8_000), budgetConfig, undefined, 'co-drain-run',
      async () => 'answered', 'chat', drainStep()), { allowed: true, value: 'answered' });
  });
});

// ── Phase E1b: the shared refusal mapper and the bucket aggregate ────────────

describe('companyAiBudgetRefusal with split scopes (spec §9.1, §12.3)', () => {
  it('maps insufficient to AI_BUDGET_INSUFFICIENT and reports the scope that blocked', () => {
    assert.deepEqual(
      companyAiBudgetRefusal({ allowed: false, reason: 'insufficient', spendSatang: 2_900, reservedSatang: 0, budgetSatang: 3_000, budgetScope: 'CHAT' }),
      { code: 'AI_BUDGET_INSUFFICIENT', budgetScope: 'CHAT' },
    );
    assert.deepEqual(
      companyAiBudgetRefusal({ allowed: false, reason: 'insufficient', spendSatang: 0, reservedSatang: 6_900, budgetSatang: 7_000, budgetScope: 'OCR' }),
      { code: 'AI_BUDGET_INSUFFICIENT', budgetScope: 'OCR' },
    );
  });

  it('carries a bucket scope on exceeded too — a full CHAT must not be reported as the TOTAL', () => {
    assert.deepEqual(
      companyAiBudgetRefusal({ allowed: false, reason: 'exceeded', spendSatang: 3_000, budgetSatang: 3_000, override: true, budgetScope: 'CHAT' }),
      { code: 'AI_MONTHLY_BUDGET_EXCEEDED', budgetScope: 'CHAT' },
    );
  });

  it('keeps TOTAL for every SHARED refusal — byte-for-byte what the five seams see today', () => {
    assert.deepEqual(
      companyAiBudgetRefusal({ allowed: false, reason: 'exceeded', spendSatang: 10, budgetSatang: 10, override: false }),
      { code: 'AI_MONTHLY_BUDGET_EXCEEDED', budgetScope: 'TOTAL' },
    );
    assert.deepEqual(companyAiBudgetRefusal({ allowed: false, reason: 'unavailable' }), { code: 'AI_BUDGET_UNAVAILABLE', budgetScope: 'TOTAL' });
    assert.deepEqual(
      companyAiBudgetRefusal({ allowed: false, reason: 'busy', retryAfterSeconds: 3 }),
      { code: 'AI_BUDGET_BUSY', budgetScope: 'TOTAL', retryAfterSeconds: 3 },
    );
  });
});

describe('recordCompanyAiUsage bucket aggregate (ADR 0013 §3)', () => {
  /** The `fakePrisma` above predates the bucket table on purpose; this one has it. */
  function bucketPrisma() {
    const ops: Array<{ op: string; args: any }> = [];
    const client = {
      companyAiConfiguration: { findUnique: async () => null },
      $transaction: async (fn: (tx: any) => Promise<any>) => fn({
        aiUsageEvent: { createMany: async (args: any) => { ops.push({ op: 'createMany', args }); return { count: args.data.length }; } },
        companyAiMonthlyUsage: { upsert: async (args: any) => { ops.push({ op: 'month', args }); return { costSatang: 347 }; } },
        companyAiMonthlyBucketUsage: { upsert: async (args: any) => { ops.push({ op: 'bucket', args }); return {}; } },
      }),
    };
    return { prisma: { client } as any, ops };
  }

  it('increments the bucket row in the SAME transaction, for a SHARED company too', async () => {
    const { prisma, ops } = bucketPrisma();

    await recordCompanyAiUsage(prisma, config, {
      companyId: 'co-1', sourceRoute: 'receipt-ocr', monthKey: '2026-09',
      ...classifyAiUsageRequest('receipt-ocr', 'image'),
    }, [usage()]);

    // Row order is FIXED across all three writers of these aggregates: month FIRST, then bucket.
    // The reverse order would deadlock against a concurrent `settleAiBudgetStep` and LOSE usage.
    assert.deepEqual(ops.map((o) => o.op), ['createMany', 'month', 'bucket']);
    const bucket = ops.find((o) => o.op === 'bucket')!.args;
    assert.deepEqual(bucket.where.companyId_monthKey_bucket, { companyId: 'co-1', monthKey: '2026-09', bucket: 'OCR' });
    assert.deepEqual(bucket.update.costSatang, { increment: 347 });
    assert.deepEqual(bucket.update.callCount, { increment: 1 });
  });

  it('writes no bucket row when the bucket is UNKNOWN — it is never guessed (spec §12.2)', async () => {
    const { prisma, ops } = bucketPrisma();

    await recordCompanyAiUsage(prisma, config, { companyId: 'co-1', sourceRoute: 'legacy-route' }, [usage()]);

    assert.deepEqual(ops.map((o) => o.op), ['createMany', 'month']);
  });

  it('a fake that predates the bucket table still records — the aggregate is derived data', async () => {
    const { prisma, transactions } = fakePrisma();

    const spend = await recordCompanyAiUsage(prisma, config, {
      companyId: 'co-1', sourceRoute: 'line-turn', ...classifyAiUsageRequest('line-turn', 'text'),
    }, [usage()]);

    assert.deepEqual(spend, { pre: 0, post: 347 });
    assert.deepEqual(transactions[0]!.map((o) => o.op), ['createMany', 'upsert']);
  });
});

// ── The ONE readiness projection every admin/ops surface reads (spec §11.4, R-10) ────────────

describe('readAiBudgetReadiness — the truth table admin surfaces must agree with', () => {
  /** A fake carrying the four delegates the snapshot reads, so every state is expressible. */
  const tx = (state: {
    total?: number;
    buckets?: Array<{ bucket: string; costSatang: number }>;
    holds?: Array<{ bucket: string; status: string; upperBoundSatang: number }>;
    breach?: number;
  } = {}) => ({
    companyAiMonthlyUsage: { findUnique: async () => ({ costSatang: state.total ?? 0 }) },
    companyAiMonthlyBucketUsage: { findMany: async () => state.buckets ?? [] },
    aiBudgetReservation: {
      groupBy: async () => (state.holds ?? []).map((hold) => ({
        bucket: hold.bucket, status: hold.status,
        _sum: { upperBoundSatang: hold.upperBoundSatang }, _count: { _all: 1 },
      })),
      count: async () => state.breach ?? 0,
    },
  });
  const split = (chat: number, ocr: number) => ({
    budgetMode: 'SPLIT', chatMonthlyBudgetSatang: chat, ocrMonthlyBudgetSatang: ocr, budgetConfigVersion: 1,
  });
  const readiness = (client: any, row: any, totalSatang: number, boundSatang?: number) =>
    readAiBudgetReadiness(client, { companyId: 'co-1', monthKey: '2026-09', row, totalSatang,
      ...(boundSatang === undefined ? {} : { boundSatang }) });

  it('SHARED keeps OCR under the total and reports the separate 80-credit CHAT stop', async () => {
    // Open: 3000 of 10000 spent.
    assert.deepEqual(await readiness(tx({ total: 3000 }), null, 10_000), {
      mode: 'SHARED', total: 'OK', chat: 'OK', ocr: 'OK', unresolvedHolds: 0, breach: false,
      reserved: { TOTAL: 0, CHAT: 0, OCR: 0 },
    });
    // TOTAL may be exhausted by OCR while the independent CHAT allowance remains available.
    assert.deepEqual(await readiness(tx({ total: 10_000, buckets: [{ bucket: 'OCR', costSatang: 10_000 }] }), { budgetMode: 'SHARED' }, 10_000), {
      mode: 'SHARED', total: 'EXHAUSTED', chat: 'OK', ocr: 'EXHAUSTED', unresolvedHolds: 0, breach: false,
      reserved: { TOTAL: 0, CHAT: 0, OCR: 0 },
    });
    // Admin tab rework: a SHARED chat value is the admin's chat credit (0 closes chat); OCR stays under TOTAL.
    const closedChat = { budgetMode: 'SHARED', chatMonthlyBudgetSatang: 0, ocrMonthlyBudgetSatang: 0 };
    const answer = await readiness(tx({ total: 1 }), closedChat, 10_000);
    assert.equal(answer.ocr, 'OK');
    assert.equal(answer.chat, 'CLOSED');
    const chatFull = await readiness(tx({ total: 8000, buckets: [{ bucket: 'CHAT', costSatang: 8000 }] }),
      null, 20_000);
    assert.equal(chatFull.chat, 'EXHAUSTED');
    assert.equal(chatFull.ocr, 'OK');

    const adminCredit = await readiness(tx({ total: 12_000, buckets: [{ bucket: 'CHAT', costSatang: 12_000 }] }),
      { monthlyBudgetSatang: 20_000, chatMonthlyBudgetSatang: 20_000, budgetMode: 'SHARED' }, 20_000);
    assert.equal(adminCredit.chat, 'OK', 'an admin chat credit sets the SHARED CHAT cap');
    const ceilingOnly = await readiness(tx({ total: 12_000, buckets: [{ bucket: 'CHAT', costSatang: 12_000 }] }),
      { monthlyBudgetSatang: 20_000, budgetMode: 'SHARED' }, 20_000);
    assert.equal(ceilingOnly.chat, 'EXHAUSTED', 'a TOTAL override is the safety ceiling, not the chat credit');
  });

  it('SPLIT: CHAT full leaves OCR open, and OCR full leaves CHAT open — no borrowing (§12.1)', async () => {
    const chatFull = await readiness(
      tx({ total: 3000, buckets: [{ bucket: 'CHAT', costSatang: 3000 }] }), split(3000, 7000), 10_000);
    assert.equal(chatFull.chat, 'EXHAUSTED');
    assert.equal(chatFull.ocr, 'OK');
    assert.equal(chatFull.total, 'OK');

    const ocrFull = await readiness(
      tx({ total: 7000, buckets: [{ bucket: 'OCR', costSatang: 7000 }] }), split(3000, 7000), 10_000);
    assert.equal(ocrFull.ocr, 'EXHAUSTED');
    assert.equal(ocrFull.chat, 'OK');
    assert.equal(ocrFull.total, 'OK');
  });

  it('SPLIT: the TOTAL stays the ceiling neither bucket may cross', async () => {
    const answer = await readiness(
      tx({ total: 10_000, buckets: [{ bucket: 'CHAT', costSatang: 3000 }, { bucket: 'OCR', costSatang: 7000 }] }),
      split(3000, 7000), 10_000);
    assert.equal(answer.total, 'EXHAUSTED');
  });

  it('a cap of 0 is CLOSED, not EXHAUSTED — the bucket is not allowed at all (§12.1)', async () => {
    const answer = await readiness(tx(), split(10_000, 0), 10_000);
    assert.equal(answer.ocr, 'CLOSED');
    assert.equal(answer.chat, 'OK');
  });

  it('an unreadable policy closes every scope and names the reason — fail closed like admission', async () => {
    for (const [row, reason] of [
      [{ budgetMode: 'SPLIT', chatMonthlyBudgetSatang: null, ocrMonthlyBudgetSatang: 7000 }, 'SPLIT_CAPS_MISSING'],
      [split(9000, 7000), 'SPLIT_EXCEEDS_TOTAL'],
      [{ budgetMode: 'SHARED', pendingBudgetPolicy: { mode: 'WAT' } }, 'POLICY_MALFORMED'],
    ] as const) {
      assert.deepEqual(await readiness(tx({ total: 0 }), row, 10_000), {
        mode: reason === 'SPLIT_EXCEEDS_TOTAL' || reason === 'SPLIT_CAPS_MISSING' ? 'SPLIT' : 'SHARED',
        total: 'CLOSED', chat: 'CLOSED', ocr: 'CLOSED', policyInvalid: reason,
        // Fail-closed still reports the held position: an operator fixing the policy has to know
        // credit is parked (credit-wording spec §5.3).
        unresolvedHolds: 0, breach: false, reserved: { TOTAL: 0, CHAT: 0, OCR: 0 },
      });
    }
  });

  it('reports unresolved holds and the breach flag beside the scopes, never folded into them', async () => {
    const answer = await readiness(tx({
      total: 100, buckets: [{ bucket: 'OCR', costSatang: 100 }],
      holds: [{ bucket: 'OCR', status: 'UNRESOLVED', upperBoundSatang: 400 }], breach: 1,
    }), split(3000, 7000), 10_000);

    assert.equal(answer.unresolvedHolds, 1);
    assert.equal(answer.breach, true);
    // §5.3: the same snapshot reports the held satang per scope, so a consumer never reads it twice.
    assert.deepEqual(answer.reserved, { TOTAL: 400, CHAT: 0, OCR: 400 });
    // Money is still left in both buckets; the two flags are what an operator acts on.
    assert.equal(answer.ocr, 'OK');
    assert.equal(answer.chat, 'OK');
  });

  it('only a caller with a known bound may hear INSUFFICIENT; general readiness says "money is left"', async () => {
    const state = { total: 6900, buckets: [{ bucket: 'OCR', costSatang: 6900 }] };
    // §11.4: without a bound, a surface may only say money is left — never that the next picture starts.
    assert.equal((await readiness(tx(state), split(3000, 7000), 10_000)).ocr, 'OK');
    // With one: 6900 + 0 held + 500 > the 7000 cap. Money is left, so this is NOT "เต็ม" (§12.3).
    assert.equal((await readiness(tx(state), split(3000, 7000), 10_000, 500)).ocr, 'INSUFFICIENT_FOR_KNOWN_BOUND');
    // Live holds count against the bound exactly as they do at admission, and a bound that fits
    // the cap EXACTLY still fits — the same `>` comparison `decideAiBudgetStep` makes.
    const held = { ...state, holds: [{ bucket: 'OCR', status: 'RESERVED', upperBoundSatang: 90 }] };
    assert.equal((await readiness(tx(held), split(3000, 7000), 10_000, 10)).ocr, 'OK');
    assert.equal((await readiness(tx(held), split(3000, 7000), 10_000, 11)).ocr, 'INSUFFICIENT_FOR_KNOWN_BOUND');
  });

  it('a fake predating the reservation tables reports the TOTAL it can read, and zeroes the rest', async () => {
    // The tolerance `readAiBudgetMonthSnapshot` already gives: the support timeline's own prisma
    // fake has no bucket/reservation delegates, and must still get today's SHARED answer.
    const legacy = { companyAiMonthlyUsage: { findUnique: async () => ({ costSatang: 10_000 }) } };
    assert.deepEqual(await readiness(legacy, null, 10_000), {
      mode: 'SHARED', total: 'EXHAUSTED', chat: 'OK', ocr: 'EXHAUSTED', unresolvedHolds: 0, breach: false,
      reserved: { TOTAL: 0, CHAT: 0, OCR: 0 },
    });
  });
});

describe('recordCompanyAiCostAdjustment bucket aggregate', () => {
  /** Ledger fake WITH the bucket table, so both `count === 0` causes can be told apart. */
  function bucketAdjustmentPrisma(bucketRow: { costSatang: number } | null) {
    const monthAggregate = { costSatang: 1_000 };
    const created: any[] = [];
    let bucket = bucketRow;
    const client = {
      $transaction: async (fn: (tx: any) => Promise<any>) => fn({
        aiUsageEvent: {
          findUnique: async (args: any) => (args.where.correctionKey !== undefined
            ? created.find((row) => row.correctionKey === args.where.correctionKey) ?? null
            : {
              id: 'evt-1', companyId: 'co-1', monthKey: '2026-09', sourceRoute: 'receipt-ocr',
              usageTag: 'ocr.receipt.image-read', modelId: 'haiku', thbPerUsd: 33,
              thbPerUsdSource: 'stored', requestKind: 'IMAGE', budgetBucket: 'OCR',
              usageBasis: 'PROVIDER_REPORTED', requestId: 'req-1', eventKind: 'MODEL_CALL',
            }),
          create: async (args: any) => { created.push(args.data); return args.data; },
        },
        companyAiMonthlyUsage: {
          updateMany: async (args: any) => {
            const blocked = Object.entries(args.where)
              .filter(([, v]) => typeof v === 'object' && v !== null && 'gte' in (v as any))
              .some(([, v]) => monthAggregate.costSatang < (v as any).gte);
            if (blocked) return { count: 0 };
            monthAggregate.costSatang += (args.data.costSatang?.increment ?? 0);
            return { count: 1 };
          },
        },
        companyAiMonthlyBucketUsage: {
          updateMany: async (args: any) => {
            if (!bucket || bucket.costSatang < (args.where.costSatang?.gte ?? 0)) return { count: 0 };
            bucket.costSatang += args.data.costSatang.increment;
            return { count: 1 };
          },
          findUnique: async () => bucket,
          upsert: async (args: any) => {
            bucket = bucket ?? { costSatang: args.create.costSatang };
            if (args.update) bucket.costSatang += args.update.costSatang.increment;
            return bucket;
          },
        },
      }),
    };
    return { prisma: { client } as any, month: monthAggregate, bucketRow: () => bucket, created };
  }

  it('moves the bucket row with the same non-negative guard as the month row', async () => {
    const state = bucketAdjustmentPrisma({ costSatang: 500 });

    assert.equal(await recordCompanyAiCostAdjustment(state.prisma, {
      eventId: 'evt-1', correctionKey: 'c-1', costSatang: -120,
    }), 'applied');
    assert.equal(state.month.costSatang, 880);
    assert.equal(state.bucketRow()!.costSatang, 380);
  });

  it('refuses when the bucket row EXISTS and the delta would take it negative', async () => {
    const state = bucketAdjustmentPrisma({ costSatang: 50 });

    assert.equal(await recordCompanyAiCostAdjustment(state.prisma, {
      eventId: 'evt-1', correctionKey: 'c-2', costSatang: -120,
    }), 'refused-negative');
    assert.equal(state.created.length, 0, 'nothing is appended when the move is refused');
  });

  it('still applies when the bucket row is ABSENT — a row bucketed before the aggregate existed', async () => {
    // The month total is the authoritative money and it moved; refusing a legitimate correction
    // because a DERIVED aggregate happens to be missing would be the wrong direction.
    const state = bucketAdjustmentPrisma(null);

    assert.equal(await recordCompanyAiCostAdjustment(state.prisma, {
      eventId: 'evt-1', correctionKey: 'c-3', costSatang: -120,
    }), 'applied');
    assert.equal(state.month.costSatang, 880);
  });
});

/**
 * Phase E1c: the gateway now stamps every usage row with the invocation it was held against, so a
 * multi-call chain settles each of its own calls instead of leaving the remainder metered-but-unheld
 * (ADR 0013 §11.13, which this closes).
 */
describe('recordCompanyAiUsage settles each gateway-tagged invocation (E1c)', () => {
  const ENVELOPE_KEY = 'co-1#line-image:abc#receipt-ocr#0';

  /**
   * The settlement engine's own path, cut at its first read: the locator returns nothing, so every
   * settle answers `unknown-invocation`. That is enough to prove WHICH invocation key each entry
   * was settled against, which is the whole contract of this seam; the ledger writes themselves are
   * covered by the reservation engine's own specs (including on real PostgreSQL).
   */
  function settleProbe() {
    const settled: string[] = [];
    const metered: any[] = [];
    const client = {
      companyAiConfiguration: { findUnique: async () => null },
      $transaction: async (fn: (tx: any) => Promise<any>) => fn({
        $executeRaw: async () => 1,
        aiBudgetReservation: {
          findUnique: async (args: any) => { settled.push(args.where.invocationKey); return null; },
        },
        aiUsageEvent: { createMany: async (args: any) => { metered.push(...args.data); return { count: args.data.length }; } },
        companyAiMonthlyUsage: { upsert: async () => ({ costSatang: 347 }) },
        companyAiMonthlyBucketUsage: { upsert: async () => ({}) },
      }),
    };
    return { prisma: { client } as any, settled, metered };
  }

  const meta = {
    companyId: 'co-1', sourceRoute: 'receipt-ocr', requestId: 'req-1', monthKey: '2026-09',
    invocationKey: ENVELOPE_KEY, ...classifyAiUsageRequest('receipt-ocr', 'image'),
  };

  it('settles a whole tagged chain against its own keys, and meters nothing unheld', async () => {
    const probe = settleProbe();

    await recordCompanyAiUsage(probe.prisma, config, meta, [
      usage({ tag: 'ocr.receipt.image-read', invocationKey: 'co-1#line-image:abc#receipt-ocr#0' }),
      usage({ tag: 'ocr.receipt.extract', invocationKey: 'co-1#line-image:abc#receipt-ocr#1' }),
      usage({ tag: 'ocr.receipt.extract-repair', invocationKey: 'co-1#line-image:abc#receipt-ocr#2' }),
    ]);

    assert.deepEqual(probe.settled, [
      'co-1#line-image:abc#receipt-ocr#0',
      'co-1#line-image:abc#receipt-ocr#1',
      'co-1#line-image:abc#receipt-ocr#2',
    ]);
    assert.deepEqual(probe.metered, [], 'every row is held, so nothing falls through to plain metering');
  });

  it('keeps the older gateway behaviour for an UNTAGGED chain: first held, remainder metered', async () => {
    const probe = settleProbe();

    await recordCompanyAiUsage(probe.prisma, config, meta, [
      usage({ tag: 'ocr.receipt.image-read' }),
      usage({ tag: 'ocr.receipt.extract' }),
    ]);

    assert.deepEqual(probe.settled, [ENVELOPE_KEY], 'the first row is this seam own invocation');
    // Never dropped — real provider spend must not become zero (spec §12.6).
    assert.deepEqual(probe.metered.map((row) => [row.usageTag, row.invocationKey]),
      [['ocr.receipt.extract', undefined]]);
  });

  it('refuses a tag from ANOTHER attempt or tenant, and never settles that key', async () => {
    const table = [
      ['another company', 'co-2#line-image:abc#receipt-ocr#1'],
      ['another attempt', 'co-1#line-image:zzz#receipt-ocr#1'],
      ['another step kind', 'co-1#line-image:abc#line-turn#1'],
      ['a non-numeric ordinal', 'co-1#line-image:abc#receipt-ocr#x'],
      ['a truncated key', 'co-1#line-image:abc'],
      ['an empty key', ''],
    ] as const;
    for (const [label, foreign] of table) {
      const probe = settleProbe();

      await recordCompanyAiUsage(probe.prisma, config, meta, [
        usage({ tag: 'ocr.receipt.image-read', invocationKey: ENVELOPE_KEY }),
        usage({ tag: 'ocr.receipt.extract', invocationKey: foreign }),
      ]);

      // The envelope key is used once, for the row that really carries it; the foreign tag buys
      // nothing — the fence is a GLOBAL unique index and must not be reachable from a response.
      assert.deepEqual(probe.settled, [ENVELOPE_KEY], label);
      assert.deepEqual(probe.metered.map((row) => row.usageTag), ['ocr.receipt.extract'], label);
    }
  });

  it('settles a mixed response by key, using the envelope only for an untagged row', async () => {
    const probe = settleProbe();

    await recordCompanyAiUsage(probe.prisma, config, meta, [
      // The ordinal-1 row is tagged, the ordinal-0 one is not (an older row in a rolling deploy).
      usage({ tag: 'ocr.receipt.extract', invocationKey: 'co-1#line-image:abc#receipt-ocr#1' }),
      usage({ tag: 'ocr.receipt.image-read' }),
    ]);

    assert.deepEqual(probe.settled, ['co-1#line-image:abc#receipt-ocr#1', ENVELOPE_KEY]);
    assert.deepEqual(probe.metered, []);
  });

  it('ignores the tags entirely for a company with no envelope (SHARED, every company today)', async () => {
    const probe = settleProbe();

    await recordCompanyAiUsage(probe.prisma, config, { ...meta, invocationKey: undefined }, [
      usage({ tag: 'ocr.receipt.image-read', invocationKey: ENVELOPE_KEY }),
    ]);

    assert.deepEqual(probe.settled, [], 'no reservation is touched without an envelope');
    assert.deepEqual(probe.metered.map((row) => [row.usageTag, row.invocationKey]),
      [['ocr.receipt.image-read', undefined]]);
  });
});


describe('owner no-charge rule on SHARED', () => {
  it('retains failed cost without changing month, CHAT credit, calls or threshold alerts', async () => {
    const { prisma, events, aggregate, transactions } = fakePrisma(1_000);
    const meta = { companyId: 'shared', sourceRoute: 'line-turn', requestId: 'ok', budgetBucket: 'CHAT' as const };
    await recordCompanyAiUsage(prisma, config, meta, [usage()]);
    const before = structuredClone(aggregate);
    const failed = await recordCompanyAiUsage(prisma, config, { ...meta, requestId: 'timeout' }, [
      usage({ ok: false, usageBasis: 'CONSERVATIVE_ESTIMATE', inputTokens: 1200, outputTokens: 17,
        cacheReadInputTokens: 0, cacheWriteInputTokens: 0, errorCode: 'PROVIDER_TIMEOUT' }),
      usage({ ok: false, usageBasis: 'PROVIDER_REPORTED', errorCode: 'PROVIDER_BLOCKED' }),
    ]);
    assert.equal(failed, undefined);
    assert.deepEqual(aggregate, before);
    assert.equal(transactions[1]!.some(op => op.op === 'upsert'), false);
    assert.equal(events.length, 3);
    assert.ok(events[1].costSatang > 0);
    assert.equal(events[1].inputTokens, 1200);
    assert.deepEqual(events.slice(1).map(row => [row.eventKind, row.usageBasis]),
      [['MODEL_CALL', 'COMPANY_ABSORBED'], ['MODEL_CALL', 'COMPANY_ABSORBED']]);
    assert.equal(warnings.some(w => w.msg === 'ai.company_budget.threshold'), false);
  });

  it('records both distinct provider calls sharing one requestId, route and tag', async () => {
    const { prisma, events, aggregate, transactions } = fakePrisma();
    const meta = { companyId: 'shared', sourceRoute: 'receipt-capture', requestId: 'one-job' };
    await recordCompanyAiUsage(prisma, config, meta, [usage({ tag: 'ocr.capture.read', inputTokens: 1000 })]);
    await recordCompanyAiUsage(prisma, config, meta, [usage({ tag: 'ocr.capture.read', inputTokens: 2000 })]);
    assert.equal(events.length, 2, 'each batch starts at ordinal zero but represents a different provider call');
    assert.deepEqual(events.map(row => [row.requestId, row.sourceRoute, row.usageTag, row.inputTokens, row.invocationKey]), [
      ['one-job', 'receipt-capture', 'ocr.capture.read', 1000, undefined],
      ['one-job', 'receipt-capture', 'ocr.capture.read', 2000, undefined],
    ]);
    assert.equal(Object.values(aggregate)[0], events[0].costSatang + events[1].costSatang);
    for (const ops of transactions) {
      assert.equal(ops[0]!.args.skipDuplicates, undefined, 'SHARED writes never silently skip rows');
      assert.equal(ops[1]!.args.create.callCount, 1);
    }
  });

  it('only ok=false grants absorbed treatment; a successful wire row cannot choose it', async () => {
    const { prisma, events, aggregate } = fakePrisma();
    await recordCompanyAiUsage(prisma, config, { companyId: 'shared', sourceRoute: 'line-turn' },
      [usage({ usageBasis: 'COMPANY_ABSORBED' })]);
    assert.equal(events[0].usageBasis, null);
    assert.equal(Object.values(aggregate)[0], 347);
  });
});


it('budget info logs follow committed holds and settlements without user text or signing secrets', async t => {
  const { reserveAiBudgetStep, settleAiBudgetStep } = await import('./company-ai-budget-reservation');
  const { splitPrisma } = await import('./company-ai-budget-prisma.fixture');
  const { priceRenderedAiInvocationV2 } = await import('./ai-model-pricing');
  const logs: any[] = [];
  const info = t.mock.method(Logger.prototype, 'log', (value: any) => logs.push(value));
  const modelId = 'apac.anthropic.claude-3-haiku-20240307-v1:0';
  const priced = priceRenderedAiInvocationV2({ version: 'test:1', provider: 'bedrock', modelId, region: 'ap-southeast-1', thbPerUsd: 33,
    usdPerMTok: { input: 0.25, output: 1.25, cacheRead: 0.03, cacheWrite: 0.3 } }, 4096, 2048)!;
  for (const failed of [false, true]) for (const overrun of [false, true]) {
    const fixture = splitPrisma({ total: 10000, chat: 5000, ocr: 5000 });
    const input = { companyId: 'co', monthKey: '2026-10', bucket: 'CHAT' as const, stepKind: 'provider-v2', attemptKey: 'opaque-attempt', ordinal: 0,
      sourceRoute: 'line-ai-v2', modelId, thbPerUsd: 33, thbPerUsdSource: 'pinned-grant' };
    const start = logs.length;
    const outcome = await reserveAiBudgetStep(fixture.prisma, config, input, { ...priced, maxCalls: 3, authorizeAndClaim: async () => true,
      snapshot: { ...priced.snapshot, profileId: 'line-intake-text/2', estimatorVersion: 'utf8-split-prefix-v4', grantSignature: 'never-log-this-secret' } });
    assert.equal(outcome.ok, true); if (!outcome.ok) throw new Error('reserve failed');
    assert.deepEqual(logs[start], { msg: 'ai.budget.reserved', companyId: 'co', reservationId: outcome.reservation.id,
      profileId: 'line-intake-text/2', usageTag: null, estimatorVersion: 'utf8-split-prefix-v4', inputTokenBound: 4096, outputBound: 2048, holdSatang: priced.upperBoundSatang });
    const entry = { tag: 'line.intake-route', modelId, ok: !failed, inputTokens: overrun ? 100000 : 1000, outputTokens: 100,
      cacheReadInputTokens: 20, cacheWriteInputTokens: 30, durationMs: 1, usageBasis: 'PROVIDER_REPORTED' as const };
    const settle = { invocationKey: outcome.reservation.invocationKey, meta: { sourceRoute: 'line-ai-v2' }, entry };
    assert.equal(await settleAiBudgetStep(fixture.prisma, settle), 'settled');
    const hold = fixture.reservations.get(outcome.reservation.id), evidence = hold.evidenceJson;
    assert.deepEqual(logs.at(-1), { msg: 'ai.budget.settled', reservationId: hold.id, usageTag: entry.tag, settledSatang: fixture.events.get(settle.invocationKey).costSatang,
      holdSatang: hold.upperBoundSatang, inputTokens: entry.inputTokens, outputTokens: entry.outputTokens,
      cacheReadInputTokens: 20, cacheWriteInputTokens: 30, overrun: !failed && overrun,
      customerChargedSatang: evidence.customerChargedSatang, companyAbsorbedSatang: evidence.companyAbsorbedSatang });
    assert.equal(logs.length, start + 2);
    assert.equal(await settleAiBudgetStep(fixture.prisma, settle), 'duplicate');
    assert.equal((await reserveAiBudgetStep(fixture.prisma, config, input, { ...priced, maxCalls: 3, authorizeAndClaim: async () => true })).ok, false);
    assert.equal(logs.length, start + 2, 'replays produce no second money log');
    assert.doesNotMatch(JSON.stringify(logs), /never-log-this-secret|ownerToken|prompt|messageText|grantSignature/u);
  }
  const rolledBack = splitPrisma({ total: 10000, chat: 5000, ocr: 5000 });
  rolledBack.prisma.client.$transaction = async () => { throw new Error('rollback'); };
  const start = logs.length;
  assert.equal(await settleAiBudgetStep(rolledBack.prisma, { invocationKey: 'unknown', meta: { sourceRoute: 'line-ai-v2' }, entry: usage() }), 'failed');
  assert.equal(logs.length, start);
  const loggingFailure = splitPrisma({ total: 10000, chat: 5000, ocr: 5000 });
  info.mock.mockImplementation(() => { throw new Error('logger unavailable'); });
  const reserved = await reserveAiBudgetStep(loggingFailure.prisma, config, { companyId: 'co', monthKey: '2026-10', bucket: 'CHAT',
    stepKind: 'receipt-ocr', attemptKey: 'opaque', ordinal: 0, sourceRoute: 'line-ai-v2', modelId, thbPerUsd: 33, thbPerUsdSource: 'stored' });
  assert.equal(reserved.ok, true); if (!reserved.ok) throw new Error('reservation failed');
  assert.equal(await settleAiBudgetStep(loggingFailure.prisma, { invocationKey: reserved.reservation.invocationKey,
    meta: { sourceRoute: 'line-ai-v2' }, entry: usage({ modelId }) }), 'settled-anomaly');
});
