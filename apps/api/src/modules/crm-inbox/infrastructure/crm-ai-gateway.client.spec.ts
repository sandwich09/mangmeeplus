import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { HttpException } from '@nestjs/common';
import type { CrmConversationSummaryRequest } from '@watchdog-bms/contracts';
import { __resetCompanyAiBudgetCache } from '../../line-ai/application/company-ai-usage-meter';
import { CrmAiGatewayClient } from './crm-ai-gateway.client';

const config = {
  aiGatewayInternalUrl: 'http://ai-gateway.test',
  aiGatewayInternalSecret: 'internal-secret',
  approvedAiModelIds: ['apac.model-v1'],
  aiLlmMaxPerCompany: 60,
  aiRateLimitWindowSeconds: 60,
  aiMonthlyBudgetSatang: 200_000,
} as any;

const rateLimits = { consume: async () => ({ allowed: true, retryAfterSeconds: 0, count: 1 }) } as any;

// The client now budget-checks whenever it holds a prisma, so every fake needs the aggregate
// delegate too — a missing meter fails closed by design.
const prismaWith = (row: { modelId: string } | null, spendSatang?: number) =>
  ({
    client: {
      companyAiConfiguration: { findUnique: async () => row },
      companyAiMonthlyUsage: { findUnique: async () => (spendSatang === undefined ? null : { costSatang: spendSatang }) },
    },
  }) as any;

// The budget cache is module-level and keyed only by companyId.
beforeEach(__resetCompanyAiBudgetCache);

// companyId is required on every CRM request type: the rate limiter, the model-policy
// resolution below, and the usage attribution all read it from the envelope.
const summaryRequest: CrmConversationSummaryRequest = { requestId: 'req-1', companyId: 'company-1', window: [] };

async function postAndCapture(client: CrmAiGatewayClient): Promise<{ body?: Record<string, unknown>; calls: number }> {
  const originalFetch = globalThis.fetch;
  let body: Record<string, unknown> | undefined;
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls += 1;
    body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return { ok: true, json: async () => ({ requestId: 'req-1', status: 'uncertain' }) } as Response;
  };
  try {
    await client.requestCrmSummary(summaryRequest);
  } finally {
    globalThis.fetch = originalFetch;
  }
  return { body, calls };
}

describe('CrmAiGatewayClient per-company model policy', () => {
  it('attaches the configured tenant model to every CRM request', async () => {
    const client = new CrmAiGatewayClient(config, rateLimits, prismaWith({ modelId: 'apac.model-v1' }));

    const { body } = await postAndCapture(client);

    assert.deepEqual(body?.modelPolicy, { modelId: 'apac.model-v1' });
    assert.equal(body?.requestId, 'req-1');
    assert.equal(body?.companyId, 'company-1');
  });

  it('sends no modelPolicy key when the company has no configuration row', async () => {
    const client = new CrmAiGatewayClient(config, rateLimits, prismaWith(null));

    const { body } = await postAndCapture(client);

    assert.equal('modelPolicy' in (body ?? {}), false);
    assert.equal(body?.requestId, 'req-1');
  });

  it('fails the CRM action closed when the configured model is no longer approved', async () => {
    const client = new CrmAiGatewayClient(config, rateLimits, prismaWith({ modelId: 'global.retired-model' }));
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return { ok: true, json: async () => ({}) } as Response;
    };

    try {
      await assert.rejects(
        () => client.requestCrmSummary(summaryRequest),
        /TENANT_AI_MODEL_NOT_APPROVED/,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }

    assert.equal(calls, 0);
  });
});

// ── usage metering seam (spec §7.5 recording half; criteria 3 and 10) ──────────────

const meteringConfig = { ...config, aiThbPerUsd: 33 } as any;

const usageRow = {
  tag: 'crm_summary',
  modelId: 'apac.model-v1',
  ok: true,
  inputTokens: 10_000,
  outputTokens: 2_000,
  cacheReadInputTokens: 50_000,
  cacheWriteInputTokens: 8_000,
  durationMs: 900,
};

/** Model-policy fake plus the ledger delegates the meter needs. */
function meteringPrisma(onTransaction?: () => void) {
  const created: any[] = [];
  const upserts: any[] = [];
  const client = {
    companyAiConfiguration: { findUnique: async () => null },
    companyAiMonthlyUsage: { findUnique: async () => null },
    $transaction: async (fn: (tx: any) => Promise<any>) => {
      onTransaction?.();
      return fn({
        aiUsageEvent: { createMany: async (args: any) => { created.push(...args.data); return { count: args.data.length }; } },
        companyAiMonthlyUsage: { upsert: async (args: any) => { upserts.push(args); return { costSatang: 347 }; } },
      });
    },
  };
  return { prisma: { client } as any, created, upserts };
}

async function callWith(client: CrmAiGatewayClient, json: unknown): Promise<unknown> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => json }) as Response;
  try {
    return await client.requestCrmSummary(summaryRequest);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

describe('CrmAiGatewayClient usage metering', () => {
  it('records one ledger row per reported model call, tagged with the route from the path', async () => {
    const { prisma, created, upserts } = meteringPrisma();
    const client = new CrmAiGatewayClient(meteringConfig, rateLimits, prisma);

    const result = await callWith(client, { requestId: 'req-1', status: 'ok', usage: [usageRow, { ...usageRow, tag: 'critic' }] });

    assert.deepEqual(result, { requestId: 'req-1', status: 'ok', usage: [usageRow, { ...usageRow, tag: 'critic' }] });
    assert.equal(created.length, 2);
    assert.equal(created[0].sourceRoute, 'crm-summary');
    assert.equal(created[0].companyId, 'company-1');
    assert.equal(created[0].requestId, 'req-1');
    assert.equal(created[0].costSatang, 347);
    assert.equal(upserts.length, 1);
  });

  it('returns the business result even when the meter throws', async () => {
    const { prisma } = meteringPrisma(() => { throw new Error('DB_DOWN'); });
    const client = new CrmAiGatewayClient(meteringConfig, rateLimits, prisma);

    const result = await callWith(client, { requestId: 'req-1', status: 'ok', usage: [usageRow] });

    assert.deepEqual(result, { requestId: 'req-1', status: 'ok', usage: [usageRow] });
  });

  it('records nothing and does not crash when the response carries no usage', async () => {
    const { prisma, created, upserts } = meteringPrisma();
    const client = new CrmAiGatewayClient(meteringConfig, rateLimits, prisma);

    const result = await callWith(client, { requestId: 'req-1', status: 'uncertain' });

    assert.deepEqual(result, { requestId: 'req-1', status: 'uncertain' });
    assert.equal(created.length, 0);
    assert.equal(upserts.length, 0);
  });
});

// ── monthly budget cap (spec §7.5 enforcement; criteria 5 and 8) ───────────────────

describe('CrmAiGatewayClient monthly budget', () => {
  /** Runs the CRM call with fetch fully stubbed, reporting whether the gateway was reached. */
  async function refusalFor(prisma: unknown): Promise<{ error: unknown; calls: number }> {
    const client = new CrmAiGatewayClient(config, rateLimits, prisma as any);
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return { ok: true, json: async () => ({ requestId: 'req-1', status: 'ok' }) } as Response;
    };
    try {
      await client.requestCrmSummary(summaryRequest);
      return { error: undefined, calls };
    } catch (error) {
      return { error, calls };
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  it('refuses with AI_MONTHLY_BUDGET_EXCEEDED (429) and never reaches the gateway', async () => {
    const { error, calls } = await refusalFor(prismaWith(null, 200_000));

    assert.ok(error instanceof HttpException);
    assert.equal(error.getStatus(), 429);
    assert.deepEqual(error.getResponse(), { code: 'AI_MONTHLY_BUDGET_EXCEEDED' });
    assert.equal(calls, 0, 'a refused action must not spend');
  });

  it('uses the distinct AI_BUDGET_UNAVAILABLE code when the meter cannot be read', async () => {
    const brokenMeter = {
      client: {
        companyAiConfiguration: { findUnique: async () => null },
        companyAiMonthlyUsage: { findUnique: async () => { throw new Error('DB_DOWN'); } },
      },
    };

    const { error, calls } = await refusalFor(brokenMeter);

    assert.ok(error instanceof HttpException);
    assert.deepEqual(error.getResponse(), { code: 'AI_BUDGET_UNAVAILABLE' }, 'an outage must not read as exhaustion');
    assert.equal(calls, 0, 'fail closed: never an unmetered pass');
  });

  it('lets a company under budget through unchanged', async () => {
    const { error, calls } = await refusalFor(prismaWith(null, 199_999));

    assert.equal(error, undefined);
    assert.equal(calls, 1);
  });
});
