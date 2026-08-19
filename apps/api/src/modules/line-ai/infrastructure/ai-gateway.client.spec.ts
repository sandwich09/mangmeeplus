import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { HttpException } from '@nestjs/common';
import type { LineAiTurnRequest } from '@watchdog-bms/contracts';
import { __resetCompanyAiBudgetCache } from '../application/company-ai-usage-meter';
import { AiGatewayClient, AiGatewayRequestError } from './ai-gateway.client';

const baseTurnRequest: LineAiTurnRequest = {
  requestId: 'request-1',
  webhookEventId: 'event-1',
  userContext: {
    lineUserId: '[REDACTED]',
    internalUserId: 'user-1',
    companyId: 'company-1',
    membershipId: 'membership-1',
    permissions: [],
    roles: ['INVENTORY'],
    locale: 'th-TH',
  },
  messageText: 'สินค้าไหนใกล้หมด',
  messagePreviewHash: 'hash',
};

describe('AiGatewayClient failure classification', () => {
  const createClient = () => new AiGatewayClient(
    {
      aiGatewayInternalUrl: 'http://ai-gateway.test/v1',
      aiGatewayInternalSecret: 'workload-secret',
    } as any,
    { issue: () => 'signed' } as any,
  );

  async function expectFetchFailure(
    fetchImpl: typeof fetch,
    expectedCode: AiGatewayRequestError['code'],
  ): Promise<void> {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchImpl;
    try {
      await assert.rejects(
        createClient().requestLineTurn(baseTurnRequest),
        (error: unknown) => error instanceof AiGatewayRequestError && error.code === expectedCode,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  it('classifies aborts and platform timeouts as retryable gateway timeouts', async () => {
    const timeout = new Error('request expired');
    timeout.name = 'TimeoutError';
    await expectFetchFailure(async () => { throw timeout; }, 'AI_GATEWAY_TIMEOUT');
  });

  it('classifies network failures as provider unavailable rather than timeout', async () => {
    await expectFetchFailure(async () => { throw new TypeError('fetch failed'); }, 'AI_GATEWAY_UNAVAILABLE');
  });

  it('classifies non-success HTTP responses as provider unavailable', async () => {
    await expectFetchFailure(
      async () => ({ ok: false, status: 503 } as Response),
      'AI_GATEWAY_UNAVAILABLE',
    );
  });
});

describe('AiGatewayClient actor delegation', () => {
  it('issues and forwards a bounded API-signed delegation pool per permitted tool', async () => {
    const issued: string[] = [];
    const client = new AiGatewayClient(
      {
        aiGatewayInternalUrl: 'http://ai-gateway.test/v1',
        aiGatewayInternalSecret: 'workload-secret',
      } as any,
      {
        issue: (input: { toolName: string }) => {
          issued.push(input.toolName);
          return `signed:${input.toolName}`;
        },
      } as any,
    );
    const request: LineAiTurnRequest = {
      requestId: 'request-1',
      webhookEventId: 'event-1',
      userContext: {
        lineUserId: '[REDACTED]',
        internalUserId: 'user-1',
        companyId: 'company-1',
        membershipId: 'membership-1',
        permissions: ['ai.tool.invoke', 'inventory.product.read', 'inventory.report.read'],
        entitledFeatureKeys: ['inventory', 'product_catalog'],
        roles: ['INVENTORY'],
        locale: 'th-TH',
      },
      messageText: 'สินค้าไหนใกล้หมด',
      messagePreviewHash: 'hash',
    };

    const originalFetch = globalThis.fetch;
    let posted: LineAiTurnRequest | undefined;
    let signal: AbortSignal | null | undefined;
    globalThis.fetch = async (_url, init) => {
      posted = JSON.parse(String(init?.body)) as LineAiTurnRequest;
      signal = init?.signal;
      return {
        ok: true,
        json: async () => ({ requestId: 'request-1' }),
      } as Response;
    };
    try {
      await client.requestLineTurn(request);
    } finally {
      globalThis.fetch = originalFetch;
    }

    assert.ok(issued.includes('inventory.list_low_stock'));
    assert.equal(posted?.actorDelegations?.['inventory.list_low_stock']?.length, 8);
    assert.equal(posted?.actorDelegations?.['inventory.list_low_stock']?.[0], 'signed:inventory.list_low_stock');
    assert.equal(posted?.actorDelegations?.['ledger.get_financial_summary'], undefined);
    assert.ok(signal instanceof AbortSignal, 'AI Gateway calls must be time-bounded');
  });

  it('does not issue a delegation for a cross-feature tool the company has not enabled', async () => {
    const issued: string[] = [];
    const client = new AiGatewayClient(
      { aiGatewayInternalUrl: 'http://ai-gateway.test/v1', aiGatewayInternalSecret: 'workload-secret' } as any,
      { issue: ({ toolName }: { toolName: string }) => { issued.push(toolName); return 'signed'; } } as any,
    );
    let posted: LineAiTurnRequest | undefined;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (_url, init) => {
      posted = JSON.parse(String(init?.body));
      return { ok: true, json: async () => ({ requestId: 'request-1' }) } as Response;
    };
    try {
      await client.requestLineTurn({
        ...baseTurnRequest,
        userContext: {
          ...baseTurnRequest.userContext,
          permissions: ['ai.tool.invoke', 'crm.report.read'],
          entitledFeatureKeys: ['crm', 'crm.overview'],
        },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
    assert.equal(issued.includes('sales.get_sales_summary'), false);
    assert.equal(posted?.actorDelegations?.['sales.get_sales_summary'], undefined);
  });
});

// ── monthly budget cap (spec §7.5 enforcement; criteria 5, 6 and 8) ────────────────

describe('AiGatewayClient monthly budget', () => {
  const budgetConfig = {
    aiGatewayInternalUrl: 'http://ai-gateway.test/v1',
    aiGatewayInternalSecret: 'workload-secret',
    aiThbPerUsd: 33,
    aiMonthlyBudgetSatang: 200_000,
  } as any;
  const delegation = { issue: () => 'signed' } as any;

  const turnRequest: LineAiTurnRequest = {
    requestId: 'request-1',
    webhookEventId: 'event-1',
    userContext: {
      lineUserId: '[REDACTED]',
      internalUserId: 'user-1',
      companyId: 'company-1',
      membershipId: 'membership-1',
      permissions: [],
      roles: ['INVENTORY'],
      locale: 'th-TH',
    },
    messageText: 'สินค้าไหนใกล้หมด',
    messagePreviewHash: 'hash',
  };

  const usageRow = {
    tag: 'line_turn',
    modelId: 'apac.anthropic.claude-3-5-sonnet-20241022-v2:0',
    ok: true,
    inputTokens: 10_000,
    outputTokens: 2_000,
    cacheReadInputTokens: 50_000,
    cacheWriteInputTokens: 8_000,
    durationMs: 1234,
  };

  /** Ledger fake whose month-to-date spend can move mid-test, plus the ledger write path. */
  function meterPrisma(initialSpend: number) {
    let spend = initialSpend;
    const recorded: any[] = [];
    const client = {
      companyAiConfiguration: { findUnique: async () => null },
      companyAiMonthlyUsage: { findUnique: async () => ({ costSatang: spend }) },
      $transaction: async (fn: (tx: any) => Promise<any>) => fn({
        aiUsageEvent: { createMany: async (args: any) => { recorded.push(...args.data); return { count: args.data.length }; } },
        companyAiMonthlyUsage: { upsert: async () => ({ costSatang: spend }) },
      }),
    };
    return { prisma: { client } as any, recorded, setSpend: (value: number) => { spend = value; } };
  }

  async function turnWith(prisma: unknown, onFetch?: () => void): Promise<{ error: unknown; calls: number }> {
    const client = new AiGatewayClient(budgetConfig, delegation, undefined, prisma as any);
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      onFetch?.();
      return { ok: true, json: async () => ({ requestId: 'request-1', usage: [usageRow] }) } as Response;
    };
    try {
      await client.requestLineTurn(turnRequest);
      return { error: undefined, calls };
    } catch (error) {
      return { error, calls };
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  beforeEach(__resetCompanyAiBudgetCache);

  it('refuses at/over budget with AI_MONTHLY_BUDGET_EXCEEDED and no retryAfterSeconds', async () => {
    const { error, calls } = await turnWith(meterPrisma(200_000).prisma);

    assert.ok(error instanceof HttpException);
    assert.equal(error.getStatus(), 429);
    // A monthly cap has no meaningful retry window, unlike the per-minute bucket.
    assert.deepEqual(error.getResponse(), { code: 'AI_MONTHLY_BUDGET_EXCEEDED' });
    assert.equal(calls, 0);
  });

  it('uses AI_BUDGET_UNAVAILABLE when the meter itself cannot be read', async () => {
    const broken = {
      client: {
        companyAiConfiguration: { findUnique: async () => null },
        companyAiMonthlyUsage: { findUnique: async () => { throw new Error('DB_DOWN'); } },
      },
    };

    const { error, calls } = await turnWith(broken);

    assert.ok(error instanceof HttpException);
    assert.deepEqual(error.getResponse(), { code: 'AI_BUDGET_UNAVAILABLE' });
    assert.equal(calls, 0);
  });

  it('never aborts an action already in flight when spend crosses the cap mid-call (§6.6)', async () => {
    const meter = meterPrisma(199_000);

    // The company goes over budget while the gateway call is outstanding. Check-before-act
    // means this turn still completes and is still metered; only the NEXT one is refused.
    const { error, calls } = await turnWith(meter.prisma, () => meter.setSpend(250_000));

    assert.equal(error, undefined, 'an in-flight action is never aborted mid-way');
    assert.equal(calls, 1);
    assert.equal(meter.recorded.length, 1, 'the overshoot is still recorded, so the next call sees it');

    const next = await turnWith(meter.prisma);
    assert.ok(next.error instanceof HttpException);
    assert.equal(next.calls, 0);
  });
});
