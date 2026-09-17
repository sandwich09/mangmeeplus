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

function governedPrisma() {
  return {
    client: {
      companyAiConfiguration: { findUnique: async () => ({ modelId: null, monthlyBudgetSatang: 1_000_000 }) },
      companyAiMonthlyUsage: { findUnique: async () => ({ costSatang: 0 }) },
    },
  } as any;
}

describe('AiGatewayClient failure classification', () => {
  const createClient = () => new AiGatewayClient(
    {
      aiGatewayInternalUrl: 'http://ai-gateway.test/v1',
      aiGatewayInternalSecret: 'workload-secret',
    } as any,
    { issue: () => 'signed' } as any,
    undefined,
    governedPrisma(),
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
      undefined,
      governedPrisma(),
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
      undefined,
      governedPrisma(),
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

describe('AiGatewayClient OCR governance', () => {
  function readyOcrPrisma() {
    const events: any[] = [];
    const compensations: any[] = [];
    const providerUsage: any[] = [];
    let usedCount = 0;
    const tx = {
      $executeRaw: async () => undefined,
      companyAiConfiguration: { findUnique: async () => ({ ocrEnabled: true, ocrMonthlyLimit: 10 }) },
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
        delete: async ({ where }: any) => events.splice(events.findIndex((event) => event.id === where.id), 1)[0],
      },
      companyOcrMonthlyUsage: {
        findUnique: async () => usedCount ? { usedCount } : null,
        upsert: async () => ({ usedCount: ++usedCount }),
        updateMany: async () => { usedCount -= 1; return { count: 1 }; },
      },
      // P10-L §15.1: no CompanyPlanTerm row = grandfathered unlimited, so the ops-brake behaviour
      // every case in this file asserts is unchanged by the commercial ceiling layered above it.
      companyPlanTerm: { findUnique: async () => null },
      auditLog: { findFirst: async () => null, create: async ({ data }: any) => { compensations.push(data); return data; } },
      aiUsageEvent: { createMany: async ({ data }: any) => { providerUsage.push(...data); return { count: data.length }; } },
      companyAiMonthlyUsage: { upsert: async ({ create }: any) => ({ costSatang: create.costSatang }) },
    };
    const prisma = {
      client: {
        companyAiConfiguration: { findUnique: async () => ({ modelId: null, monthlyBudgetSatang: 1_000_000 }) },
        companyAiMonthlyUsage: { findUnique: async () => ({ costSatang: 0 }) },
        $transaction: async (fn: (value: typeof tx) => Promise<unknown>) => fn(tx),
      },
    } as any;
    return { prisma, events, compensations, providerUsage, usedCount: () => usedCount };
  }

  it('credits one unusable system attempt exactly once while retaining actual provider spend and admitting its retry once', async () => {
    __resetCompanyAiBudgetCache();
    const state = readyOcrPrisma();
    const originalFetch = globalThis.fetch;
    const request = { requestId: 'attempt-1', companyId: 'company-1', userId: 'user-1', activeCategories: [],
      attachment: { id: 'immutable-receipt-input', mimeType: 'image/jpeg' as const, purpose: 'receipt' as const, contentBase64: 'AA==' } };
    try {
      const client = new AiGatewayClient({ aiGatewayInternalUrl: 'http://ai-gateway.test/v1', aiGatewayInternalSecret: 'secret',
        aiMonthlyBudgetSatang: 1_000_000, isProduction: false, aiThbPerUsd: 35 } as any,
      { issue: () => 'signed' } as any, undefined, state.prisma);
      globalThis.fetch = async () => new Response(JSON.stringify({ status: 'failed', errorCode: 'PROVIDER_TIMEOUT', usage: [{
        tag: 'receipt-ocr', modelId: 'anthropic.claude-sonnet-4-6', ok: false, inputTokens: 100, outputTokens: 10,
        cacheReadInputTokens: 0, cacheWriteInputTokens: 0,
      }] }));
      assert.equal((await client.requestReceiptOcr(request)).status, 'failed');
      assert.equal(state.usedCount(), 0);
      assert.equal(state.events.length, 0);
      assert.equal(state.compensations.length, 1);
      assert.equal(state.compensations[0].metadataJson.operationId, request.attachment.id);
      assert.equal(state.providerUsage.length, 1, 'real provider usage survives customer compensation');
      assert.equal(state.providerUsage[0].inputTokens, 100);
      globalThis.fetch = async () => new Response(JSON.stringify({ status: 'ok', fields: { grandTotalAmount: '120.00' } }));
      assert.equal((await client.requestReceiptOcr({ ...request, requestId: 'attempt-2' })).status, 'ok');
      assert.equal(state.usedCount(), 1);
      assert.equal(state.events.length, 1);
      assert.equal((await client.requestReceiptOcr({ ...request, requestId: 'attempt-3' })).errorCode, 'OCR_REQUEST_ALREADY_ADMITTED');
      assert.equal(state.usedCount(), 1);
      assert.equal(state.compensations.length, 1);
    } finally { globalThis.fetch = originalFetch; }
  });

  it('refuses both the LINE image router and receipt OCR before fetch when the company switch is off', async () => {
    __resetCompanyAiBudgetCache();
    let fetchCalls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      return { ok: true, json: async () => ({ status: 'ok' }) } as Response;
    };
    const tx = {
      $executeRaw: async () => undefined,
      companyOcrUsageEvent: { findUnique: async () => null },
      companyAiConfiguration: { findUnique: async () => ({ ocrEnabled: false, ocrMonthlyLimit: 10 }) },
      companyOcrMonthlyUsage: { findUnique: async () => null },
      companyPlanTerm: { findUnique: async () => null },
      auditLog: { findFirst: async () => null },
    };
    const prisma = {
      client: {
        companyAiConfiguration: { findUnique: async () => ({ monthlyBudgetSatang: null }) },
        companyAiMonthlyUsage: { findUnique: async () => ({ costSatang: 0 }) },
        $transaction: async (fn: (value: typeof tx) => Promise<unknown>) => fn(tx),
      },
    } as any;
    try {
      const client = new AiGatewayClient({
        aiGatewayInternalUrl: 'http://ai-gateway.test/v1',
        aiGatewayInternalSecret: 'workload-secret',
        aiMonthlyBudgetSatang: 1_000_000,
        isProduction: false,
      } as any, { issue: () => 'signed' } as any, undefined, prisma);
      const result = await client.requestReceiptOcr({
        requestId: 'webhook-request-1', companyId: 'company-1', userId: 'user-1',
        activeCategories: [],
        attachment: { id: 'line-message-1', mimeType: 'image/jpeg', purpose: 'receipt', contentBase64: 'AA==' },
      });
      assert.deepEqual(result, { status: 'failed', errorCode: 'OCR_FEATURE_DISABLED' });
      const route = await client.requestLineIntakeRoute({
        requestId: 'webhook-route-1', companyId: 'company-1', userId: 'user-1', locale: 'th-TH',
        messageText: '', permissions: [], activeCategories: [],
        attachments: [{ id: 'line-route-message-1', mimeType: 'image/jpeg', purpose: 'unknown', contentBase64: 'AA==' }],
      });
      assert.equal(route.ocrAdmission, 'denied');
      assert.equal(route.ocrErrorCode, 'OCR_FEATURE_DISABLED');
      assert.equal(fetchCalls, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('does not count a LINE read when the provider credential is missing', async () => {
    __resetCompanyAiBudgetCache();
    let quotaTransactions = 0;
    const prisma = {
      client: {
        companyAiConfiguration: { findUnique: async () => ({ monthlyBudgetSatang: null }) },
        companyAiMonthlyUsage: { findUnique: async () => ({ costSatang: 0 }) },
        $transaction: async () => { quotaTransactions += 1; throw new Error('unexpected OCR admission'); },
      },
    } as any;
    const client = new AiGatewayClient({
      aiGatewayInternalUrl: 'http://ai-gateway.test/v1',
      aiGatewayInternalSecret: undefined,
      aiMonthlyBudgetSatang: 1_000_000,
      isProduction: false,
    } as any, { issue: () => 'signed' } as any, undefined, prisma);

    await assert.rejects(
      () => client.requestReceiptOcr({
        requestId: 'webhook-request-no-provider', companyId: 'company-1', userId: 'user-1',
        activeCategories: [],
        attachment: { id: 'line-message-no-provider', mimeType: 'image/jpeg', purpose: 'receipt', contentBase64: 'AA==' },
      }),
      (error: unknown) => error instanceof AiGatewayRequestError && error.code === 'AI_GATEWAY_UNAVAILABLE',
    );
    assert.equal(quotaTransactions, 0);
  });

  it('releases the LINE OCR event and aggregate when Typhoon is missing downstream', async () => {
    __resetCompanyAiBudgetCache();
    const state = readyOcrPrisma();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ status: 'not_configured', errorCode: 'PROVIDER_CONFIG_MISSING' }),
    } as Response);
    try {
      const client = new AiGatewayClient({
        aiGatewayInternalUrl: 'http://ai-gateway.test/v1',
        aiGatewayInternalSecret: 'workload-secret',
        aiMonthlyBudgetSatang: 1_000_000,
        isProduction: false,
      } as any, { issue: () => 'signed' } as any, undefined, state.prisma);
      const result = await client.requestReceiptOcr({
        requestId: 'webhook-request-no-typhoon', companyId: 'company-1', userId: 'user-1',
        activeCategories: [],
        attachment: { id: 'line-message-no-typhoon', mimeType: 'image/jpeg', purpose: 'receipt', contentBase64: 'AA==' },
      });
      assert.deepEqual(result, { status: 'not_configured', errorCode: 'PROVIDER_CONFIG_MISSING' });
      assert.equal(state.events.length, 0);
      assert.equal(state.usedCount(), 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('admits one LINE document before the image router and reuses it for receipt OCR', async () => {
    __resetCompanyAiBudgetCache();
    const state = readyOcrPrisma();
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      return fetchCalls === 1
        ? new Response(JSON.stringify({ status: 'ROUTED', intent: 'EXPENSE_DOCUMENT_CAPTURE', language: 'th', confidence: 0.99 }))
        : new Response(JSON.stringify({ status: 'ok', fields: {} }));
    };
    try {
      const client = new AiGatewayClient({
        aiGatewayInternalUrl: 'http://ai-gateway.test/v1',
        aiGatewayInternalSecret: 'workload-secret',
        aiMonthlyBudgetSatang: 1_000_000,
        isProduction: false,
      } as any, { issue: () => 'signed' } as any, undefined, state.prisma);
      const route = await client.requestLineIntakeRoute({
        requestId: 'webhook-route-admitted', companyId: 'company-1', userId: 'user-1', locale: 'th-TH',
        messageText: '', permissions: [], activeCategories: [],
        attachments: [{ id: 'line-document-admitted', mimeType: 'image/jpeg', purpose: 'unknown', contentBase64: 'AA==' }],
      });
      assert.equal(route.ocrAdmission, 'admitted');
      const result = await client.requestReceiptOcr({
        requestId: 'webhook-ocr-admitted', companyId: 'company-1', userId: 'user-1', activeCategories: [],
        attachment: { id: 'line-document-admitted', mimeType: 'image/jpeg', purpose: 'receipt', contentBase64: 'AA==' },
      }, { ocrAlreadyAdmitted: true });
      assert.equal(result.status, 'ok');
      assert.equal(fetchCalls, 2);
      assert.equal(state.events.length, 1);
      assert.equal(state.usedCount(), 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  for (const scenario of ['pre_provider_refusal', 'empty', 'json_failure', 'transport', 'generic_success'] as const) {
    it(`settles the original route admission for second-stage ${scenario}`, async () => {
      __resetCompanyAiBudgetCache();
      const state = readyOcrPrisma();
      const originalFetch = globalThis.fetch;
      let identity: any;
      let calls = 0;
      globalThis.fetch = (async () => {
        calls += 1;
        if (calls === 1) return new Response(JSON.stringify({ status: 'ROUTED', intent: 'EXPENSE_DOCUMENT_CAPTURE', language: 'th', confidence: 0.99 }));
        if (scenario === 'transport') throw new Error('synthetic transport failure');
        if (scenario === 'json_failure') return new Response('{malformed');
        const result = scenario === 'pre_provider_refusal' ? { status: 'not_configured', errorCode: 'PROVIDER_CONFIG_MISSING' }
          : scenario === 'empty' ? { status: 'failed', errorCode: 'OCR_EMPTY_OUTPUT', usage: [{ tag: 'receipt-ocr', modelId: 'anthropic.claude-sonnet-4-6', ok: true, inputTokens: 1000, outputTokens: 100, cacheReadInputTokens: 0, cacheWriteInputTokens: 0 }] }
          : { status: 'ok', fields: {} };
        return new Response(JSON.stringify(result));
      }) as typeof fetch;
      try {
        const client = new AiGatewayClient({ aiGatewayInternalUrl: 'http://synthetic-gateway.test', aiGatewayInternalSecret: 'synthetic', aiMonthlyBudgetSatang: 1000000, aiThbPerUsd: 35, isProduction: false } as any,
          { issue: () => 'synthetic' } as any, undefined, state.prisma);
        const request = { requestId: `route-${scenario}`, companyId: 'company-1', userId: 'user-1', locale: 'th-TH', messageText: '', permissions: [], activeCategories: [],
          attachments: [{ id: `image-${scenario}`, mimeType: 'image/jpeg', purpose: 'unknown', contentBase64: 'AA==' }] } as any;
        await client.requestLineIntakeRoute(request, { onAdmitted: (value) => { identity = value; } });
        assert.equal(state.usedCount(), 1);
        assert.ok(identity.eventId);
        await client.requestReceiptOcr({ requestId: `ocr-${scenario}`, companyId: 'company-1', userId: 'user-1', activeCategories: [],
          attachment: { id: `image-${scenario}`, mimeType: 'image/jpeg', purpose: 'receipt', contentBase64: 'AA==' } },
          { ocrAlreadyAdmitted: true, admissionIdentity: identity }).catch(() => undefined);
        assert.equal(state.usedCount(), scenario === 'generic_success' ? 1 : 0);
        assert.equal(state.events.length, scenario === 'generic_success' ? 1 : 0);
        assert.equal(calls, 2, 'second stage reuses the route admission');
        if (scenario === 'empty') {
          assert.equal(state.providerUsage.length, 1);
          assert.ok(state.providerUsage[0].costSatang > 0, 'actual provider spend remains recorded after customer refund');
        }
      } finally { globalThis.fetch = originalFetch; }
    });
  }

  it('does not pre-admit a PDF that the intake router receives as metadata only', async () => {
    __resetCompanyAiBudgetCache();
    const state = readyOcrPrisma();
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      return fetchCalls === 1
        ? new Response(JSON.stringify({ status: 'ROUTED', intent: 'EXPENSE_DOCUMENT_CAPTURE', language: 'th', confidence: 0.99 }))
        : new Response(JSON.stringify({ status: 'ok', fields: {} }));
    };
    try {
      const client = new AiGatewayClient({
        aiGatewayInternalUrl: 'http://ai-gateway.test/v1', aiGatewayInternalSecret: 'workload-secret',
        aiMonthlyBudgetSatang: 1_000_000, isProduction: false,
      } as any, { issue: () => 'signed' } as any, undefined, state.prisma);
      const route = await client.requestLineIntakeRoute({
        requestId: 'webhook-route-pdf', companyId: 'company-1', userId: 'user-1', locale: 'th-TH',
        messageText: '', permissions: [], activeCategories: [],
        attachments: [{ id: 'line-pdf', mimeType: 'application/pdf', purpose: 'unknown', contentBase64: 'AA==' }],
      });
      assert.equal(route.ocrAdmission, undefined);
      assert.equal(state.events.length, 0);

      await client.requestReceiptOcr({
        requestId: 'webhook-ocr-pdf', companyId: 'company-1', userId: 'user-1', activeCategories: [],
        attachment: { id: 'line-pdf', mimeType: 'application/pdf', purpose: 'receipt', contentBase64: 'AA==' },
      });
      assert.equal(state.events.length, 1);
      assert.equal(state.usedCount(), 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('releases a disabled 200 router plan for receipt OCR, but blocks a second image call after an uncertain plan', async () => {
    __resetCompanyAiBudgetCache();
    const originalFetch = globalThis.fetch;
    try {
      const disabled = readyOcrPrisma();
      let disabledFetchCalls = 0;
      globalThis.fetch = async () => {
        disabledFetchCalls += 1;
        return disabledFetchCalls === 1
          ? new Response(JSON.stringify({
            status: 'UNAVAILABLE', intent: 'UNSUPPORTED', language: 'th', confidence: 0,
            errorCode: 'PROVIDER_DISABLED',
          }))
          : new Response(JSON.stringify({ status: 'ok', fields: {} }));
      };
      const disabledClient = new AiGatewayClient({
        aiGatewayInternalUrl: 'http://ai-gateway.test/v1', aiGatewayInternalSecret: 'workload-secret',
        aiMonthlyBudgetSatang: 1_000_000, isProduction: false,
      } as any, { issue: () => 'signed' } as any, undefined, disabled.prisma);
      const disabledPlan = await disabledClient.requestLineIntakeRoute({
        requestId: 'route-disabled', companyId: 'company-1', userId: 'user-1', locale: 'th-TH',
        messageText: '', permissions: [], activeCategories: [],
        attachments: [{ id: 'image-disabled', mimeType: 'image/jpeg', purpose: 'unknown', contentBase64: 'AA==' }],
      });
      assert.equal(disabledPlan.ocrAdmission, 'denied');
      assert.equal(disabledPlan.ocrErrorCode, undefined);
      assert.equal(disabled.events.length, 0);
      assert.equal(disabled.usedCount(), 0);
      assert.equal((await disabledClient.requestReceiptOcr({
        requestId: 'receipt-after-route-disabled', companyId: 'company-1', userId: 'user-1', activeCategories: [],
        attachment: { id: 'image-disabled', mimeType: 'image/jpeg', purpose: 'receipt', contentBase64: 'AA==' },
      })).status, 'ok');
      assert.equal(disabledFetchCalls, 2);
      assert.equal(disabled.events.length, 1);
      assert.equal(disabled.usedCount(), 1);

      const uncertain = readyOcrPrisma();
      globalThis.fetch = async () => new Response(JSON.stringify({
        status: 'UNAVAILABLE', intent: 'UNSUPPORTED', language: 'th', confidence: 0,
        errorCode: 'PROVIDER_TIMEOUT',
      }));
      const uncertainClient = new AiGatewayClient({
        aiGatewayInternalUrl: 'http://ai-gateway.test/v1', aiGatewayInternalSecret: 'workload-secret',
        aiMonthlyBudgetSatang: 1_000_000, isProduction: false,
      } as any, { issue: () => 'signed' } as any, undefined, uncertain.prisma);
      const uncertainPlan = await uncertainClient.requestLineIntakeRoute({
        requestId: 'route-timeout', companyId: 'company-1', userId: 'user-1', locale: 'th-TH',
        messageText: '', permissions: [], activeCategories: [],
        attachments: [{ id: 'image-timeout', mimeType: 'image/jpeg', purpose: 'unknown', contentBase64: 'AA==' }],
      });
      assert.equal(uncertainPlan.ocrAdmission, 'denied');
      assert.equal(uncertainPlan.ocrErrorCode, 'OCR_ROUTE_UNAVAILABLE');
      assert.equal(uncertain.events.length, 0);
      assert.equal(uncertain.usedCount(), 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('releases an authenticated LINE OCR fence on a pre-provider 401 but not on contradictory success JSON', async () => {
    __resetCompanyAiBudgetCache();
    const originalFetch = globalThis.fetch;
    try {
      const rejected = readyOcrPrisma();
      globalThis.fetch = async () => new Response('', { status: 401 });
      const rejectedClient = new AiGatewayClient({
        aiGatewayInternalUrl: 'http://ai-gateway.test/v1', aiGatewayInternalSecret: 'stale-secret',
        aiMonthlyBudgetSatang: 1_000_000, isProduction: false,
      } as any, { issue: () => 'signed' } as any, undefined, rejected.prisma);
      await assert.rejects(() => rejectedClient.requestReceiptOcr({
        requestId: 'webhook-http-401', companyId: 'company-1', userId: 'user-1', activeCategories: [],
        attachment: { id: 'line-http-401', mimeType: 'image/jpeg', purpose: 'receipt', contentBase64: 'AA==' },
      }), (error: unknown) => error instanceof AiGatewayRequestError && error.httpStatus === 401);
      assert.equal(rejected.events.length, 0);
      assert.equal(rejected.usedCount(), 0);

      const contradictory = readyOcrPrisma();
      globalThis.fetch = async () => new Response(JSON.stringify({ status: 'ok', errorCode: 'PROVIDER_CONFIG_MISSING' }));
      const contradictoryClient = new AiGatewayClient({
        aiGatewayInternalUrl: 'http://ai-gateway.test/v1', aiGatewayInternalSecret: 'workload-secret',
        aiMonthlyBudgetSatang: 1_000_000, isProduction: false,
      } as any, { issue: () => 'signed' } as any, undefined, contradictory.prisma);
      assert.equal((await contradictoryClient.requestReceiptOcr({
        requestId: 'webhook-contradictory', companyId: 'company-1', userId: 'user-1', activeCategories: [],
        attachment: { id: 'line-contradictory', mimeType: 'image/jpeg', purpose: 'receipt', contentBase64: 'AA==' },
      })).status, 'ok');
      assert.equal(contradictory.events.length, 1);
      assert.equal(contradictory.usedCount(), 1);

      const syntheticHttpCode = readyOcrPrisma();
      globalThis.fetch = async () => new Response(JSON.stringify({ status: 'failed', errorCode: 'AI_GATEWAY_ERROR_401' }));
      const syntheticClient = new AiGatewayClient({
        aiGatewayInternalUrl: 'http://ai-gateway.test/v1', aiGatewayInternalSecret: 'workload-secret',
        aiMonthlyBudgetSatang: 1_000_000, isProduction: false,
      } as any, { issue: () => 'signed' } as any, undefined, syntheticHttpCode.prisma);
      assert.equal((await syntheticClient.requestReceiptOcr({
        requestId: 'webhook-synthetic-http-code', companyId: 'company-1', userId: 'user-1', activeCategories: [],
        attachment: { id: 'line-synthetic-http-code', mimeType: 'image/jpeg', purpose: 'receipt', contentBase64: 'AA==' },
      })).status, 'failed');
      assert.equal(syntheticHttpCode.events.length, 0, 'system failure compensation is separate from pre-provider proof');
      assert.equal(syntheticHttpCode.usedCount(), 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
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
    assert.deepEqual(error.getResponse(), { code: 'AI_MONTHLY_BUDGET_EXCEEDED', budgetScope: 'TOTAL' });
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
    assert.deepEqual(error.getResponse(), { code: 'AI_BUDGET_UNAVAILABLE', budgetScope: 'TOTAL' });
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
