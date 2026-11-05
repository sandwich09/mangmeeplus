import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import type { LineAiTurnRequest } from '@watchdog-bms/contracts';
import { AI_BUDGET_ESTIMATOR_VERSION_V2, AI_BUDGET_PROFILE_TABLE_DIGEST_V2, AI_BUDGET_STEP_BOUNDS, createLineAiInputEvidence, lineDocumentQaInputEvidenceText, verifyLineAiInputEvidence } from '@watchdog-bms/contracts';
import { __resetCompanyAiBudgetCache } from '../application/company-ai-usage-meter';
import { aiBudgetAttemptHash } from '../application/company-ai-budget-reservation';
import { AiGatewayClient, AiGatewayRequestError } from './ai-gateway.client';
import { splitPrisma, SPLIT_FIXTURE_MODEL_ID } from '../application/company-ai-budget-prisma.fixture';

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
      company: { findUnique: async () => null },
      companyAiConfiguration: { findUnique: async () => ({ modelId: null, monthlyBudgetSatang: 1_000_000 }) },
      companyAiMonthlyUsage: { findUnique: async () => ({ costSatang: 0 }) },
      companyAiMonthlyBucketUsage: { findUnique: async () => null },
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

  it('refuses v2 input before the legacy v1 reservation path when rendered v2 holds are unavailable', async () => {
    const built = await createLineAiInputEvidence({
      turnKey: 'turn-v2', parts: [{ partId: 'part-v2', eventIdHash: 'a'.repeat(64), acceptedAtMs: 100, rawText: baseTurnRequest.messageText }],
    });
    assert.ok(built);
    const request: LineAiTurnRequest = {
      ...baseTurnRequest,
      inputEvidence: built.inputEvidence,
      contractCapabilities: ['input-evidence-v2', 'budget-envelope-v2'],
      budgetGrantV2: {
        version: 2, turnKey: 'turn-v2', authorityKind: 'webhook_event', authorityId: 'event-v2',
        channelOwnerDigest: 'b'.repeat(64), attemptKey: 'attempt-v2', monthKey: '2026-09', payerCompanyId: 'company-1',
        model: { provider: 'bedrock', modelId: 'apac.anthropic.claude-3-haiku-20240307-v1:0', region: 'ap-southeast-1' },
        allowedProfileIds: ['line-intake-text/2'], profileTableDigest: AI_BUDGET_PROFILE_TABLE_DIGEST_V2,
        maxTurnSlots: 4, maxRepairs: 1, admittedAtMs: 100, workDeadlineAtMs: 10_000, finalDeadlineAtMs: 20_000,
        nonce: 'nonce-v2', issuerVersion: 'api-1', signature: 'c'.repeat(64),
      },
    };
    const originalFetch = globalThis.fetch;
    let fetched = false;
    globalThis.fetch = async () => { fetched = true; return new Response('{}', { status: 200 }); };
    try {
      await assert.rejects(createClient().requestLineTurn(request), (error: unknown) => {
        assert.ok(error instanceof HttpException);
        assert.deepEqual(error.getResponse(), { code: 'AI_CONTRACT_UNSUPPORTED', reason: 'v2_evidence_or_authority_invalid' });
        return true;
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
    assert.equal(fetched, false, 'a v2 request must not consume a v1 hold or reach the legacy gateway route');
  });
});

describe('AiGatewayClient draft-edit capability probe', () => {
  it('returns true only for an authenticated positive response and fails closed otherwise', async () => {
    const client = new AiGatewayClient(
      { aiGatewayInternalUrl: 'http://ai-gateway.test/v1', aiGatewayInternalSecret: 'workload-secret' } as any,
      { issue: () => 'signed' } as any,
      undefined,
      governedPrisma(),
    );
    const original = globalThis.fetch;
    try {
      globalThis.fetch = (async (_input, init) => {
        assert.equal((init?.headers as Record<string, string>)['X-Internal-Secret'], 'workload-secret');
        assert.match(String(_input), /line-draft-edit-capability$/u);
        return new Response(JSON.stringify({ enabled: true }), { status: 200 });
      }) as typeof fetch;
      assert.equal(await client.lineDraftEditCapabilityEnabled('probe-1'), true);
      globalThis.fetch = (async () => new Response(JSON.stringify({ enabled: 'yes' }), { status: 200 })) as typeof fetch;
      assert.equal(await client.lineDraftEditCapabilityEnabled('probe-2'), false);
      globalThis.fetch = (async () => { throw new Error('gateway offline'); }) as typeof fetch;
      assert.equal(await client.lineDraftEditCapabilityEnabled('probe-3'), false);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe('AiGatewayClient deployed Sonnet 4.6 grant admission', () => {
  it('pins the exact existing tariff only after the approved serving model proves v2 readiness', async () => {
    const modelId = 'global.anthropic.claude-sonnet-4-6';
    const config = { aiGatewayInternalUrl: 'http://ai-gateway.test/v1', aiGatewayInternalSecret: 'workload-secret',
      approvedAiModelIds: [modelId], aiGlobalInferenceProfileApproved: true,
      aiGlobalInferenceProfileApprovalRef: 'synthetic-approved-resolution', aiThbPerUsd: 33 };
    const model = { provider: 'bedrock', modelId, region: 'ap-southeast-1', contextTokens: 200_000, maxOutputTokens: 64_000 };
    const capability = { ready: true, inputContractVersion: 2, providerOutputVersion: 2, budgetContractVersion: 2,
      profileTableDigest: AI_BUDGET_PROFILE_TABLE_DIGEST_V2, estimatorVersion: AI_BUDGET_ESTIMATOR_VERSION_V2, model };
    const input = { owner: { owner: { companyId: 'company-1' } }, serverRoute: 'fixed_read' } as any;
    let issued: any;
    const authority = { issue: async (value: unknown) => { issued = value; return { signature: 'issued-after-admission' }; } };
    const client = new AiGatewayClient(config as any, {} as any, undefined, governedPrisma(), authority as any);
    const original = globalThis.fetch;
    globalThis.fetch = (async (url, init) => {
      assert.match(String(url), /line-reliability-capabilities$/u);
      assert.equal((init?.headers as Record<string, string>)['X-Internal-Secret'], 'workload-secret');
      return new Response(JSON.stringify(capability), { status: 200 });
    }) as typeof fetch;
    try {
      assert.deepEqual(await client.issueLineReliabilityGrant('deployed-model', input), { signature: 'issued-after-admission' });
      assert.deepEqual(issued.model, { provider: 'bedrock', modelId, region: 'ap-southeast-1' });
      assert.equal(issued.serverRoute, 'fixed_read');
      assert.equal(issued.modelContextTokens, 200_000);
      assert.equal(issued.modelMaxOutputTokens, 64_000);
      assert.deepEqual(issued.tariff.usdPerMTok, { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 });
      assert.equal(issued.tariff.thbPerUsd, 33);
      for (const patch of [{ aiGlobalInferenceProfileApproved: false }, { aiGlobalInferenceProfileApprovalRef: '' },
        { aiGlobalInferenceProfileApprovalRef: '  ' }, { approvedAiModelIds: [] }]) {
        issued = undefined;
        const denied = new AiGatewayClient({ ...config, ...patch } as any, {} as any, undefined, governedPrisma(), authority as any);
        assert.equal(await denied.issueLineReliabilityGrant('denied-model', input), null);
        assert.equal(issued, undefined);
      }
      for (const patch of [{ ready: false }, { model: { ...model, provider: 'openai' } },
        { model: { ...model, contextTokens: 1_000_000 } }, { budgetContractVersion: 1 }]) {
        issued = undefined;
        globalThis.fetch = (async () => new Response(JSON.stringify({ ...capability, ...patch }), { status: 200 })) as typeof fetch;
        assert.equal(await client.issueLineReliabilityGrant('denied-capability', input), null);
        assert.equal(issued, undefined);
      }
    } finally { globalThis.fetch = original; }
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
      company: { findUnique: async () => null },
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
      companyAiMonthlyBucketUsage: { findUnique: async () => null },
    };
    const prisma = {
      client: {
        company: { findUnique: async () => null },
        companyAiConfiguration: { findUnique: async () => ({ modelId: null, monthlyBudgetSatang: 1_000_000 }) },
        companyAiMonthlyUsage: { findUnique: async () => ({ costSatang: 0 }) },
        companyAiMonthlyBucketUsage: { findUnique: async () => null },
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

  // Owner 2026-09-30 ("ทุกกรณีที่ระบบรับไว้ก่อน"): a photo accepted before the credit ran out passes the
  // MONEY cap; the receipt-read count is a different limit and still counts it.
  it('reads an accepted photo past the money cap, metered once; a fresh photo is refused before any read', async () => {
    __resetCompanyAiBudgetCache();
    const state = readyOcrPrisma();
    state.prisma.client.companyAiMonthlyUsage.findUnique = async () => ({ costSatang: 1_000_000 });
    const originalFetch = globalThis.fetch;
    let calls = 0;
    const request = { requestId: 'overcap-1', companyId: 'company-1', userId: 'user-1', activeCategories: [],
      attachment: { id: 'accepted-photo', mimeType: 'image/jpeg' as const, purpose: 'receipt' as const, contentBase64: 'AA==' } };
    try {
      const client = new AiGatewayClient({ aiGatewayInternalUrl: 'http://ai-gateway.test/v1', aiGatewayInternalSecret: 'secret',
        aiMonthlyBudgetSatang: 1_000_000, isProduction: false, aiThbPerUsd: 35 } as any, { issue: () => 'signed' } as any, undefined, state.prisma);
      globalThis.fetch = async () => {
        calls += 1;
        return new Response(JSON.stringify({ status: 'ok', fields: { grandTotalAmount: '120.00' }, usage: [{
          tag: 'receipt-ocr', modelId: 'anthropic.claude-sonnet-4-6', ok: true, inputTokens: 100, outputTokens: 10,
          cacheReadInputTokens: 0, cacheWriteInputTokens: 0,
        }] }));
      };
      await assert.rejects(client.requestReceiptOcr(request), (error: unknown) => error instanceof HttpException
        && (error.getResponse() as { code?: string }).code === 'AI_MONTHLY_BUDGET_EXCEEDED');
      assert.equal(calls, 0, 'the live path is refused before any provider call');
      assert.equal((await client.requestReceiptOcr({ ...request, requestId: 'overcap-2' }, { admitOverCap: true })).status, 'ok');
      assert.equal(calls, 1);
      assert.equal(state.providerUsage.length, 1, 'metered exactly once');
      assert.equal(state.usedCount(), 1, 'the receipt-read count still counts it');
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
      company: { findUnique: async () => null },
      companyOcrUsageEvent: { findUnique: async () => null },
      companyAiConfiguration: { findUnique: async () => ({ ocrEnabled: false, ocrMonthlyLimit: 10 }) },
      companyOcrMonthlyUsage: { findUnique: async () => null },
      companyPlanTerm: { findUnique: async () => null },
      auditLog: { findFirst: async () => null },
    };
    const prisma = {
      client: {
        company: { findUnique: async () => null },
        companyAiConfiguration: { findUnique: async () => ({ monthlyBudgetSatang: null }) },
        companyAiMonthlyUsage: { findUnique: async () => ({ costSatang: 0 }) },
        companyAiMonthlyBucketUsage: { findUnique: async () => ({ costSatang: 0 }) },
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
        company: { findUnique: async () => null },
        companyAiConfiguration: { findUnique: async () => ({ monthlyBudgetSatang: null }) },
        companyAiMonthlyUsage: { findUnique: async () => ({ costSatang: 0 }) },
        companyAiMonthlyBucketUsage: { findUnique: async () => ({ costSatang: 0 }) },
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

it('U1 image intake preserves a body credit refusal and releases the unused receipt admission', async () => {
  __resetCompanyAiBudgetCache();
  const state = readyOcrPrisma(), original = globalThis.fetch;
  const client = new AiGatewayClient({ aiGatewayInternalUrl: 'http://gateway.test', aiGatewayInternalSecret: 'secret', aiMonthlyBudgetSatang: 1_000_000, isProduction: false } as any,
    { issue: () => 'signed' } as any, undefined, state.prisma);
  globalThis.fetch = async () => new Response(JSON.stringify({ status: 'UNAVAILABLE', intent: 'UNSUPPORTED', language: 'th', confidence: 0,
    errorCode: 'AI_BUDGET_INSUFFICIENT', budgetScope: 'TOTAL', usage: [] }), { status: 200 });
  try {
    await assert.rejects(client.requestLineIntakeRoute({ requestId: 'u1-image', companyId: 'company-1', userId: 'user-1', locale: 'th-TH',
      messageText: 'สร้างใบเบิกให้หน่อย', permissions: [], activeCategories: [], attachments: [{ id: 'u1-photo', mimeType: 'image/jpeg', purpose: 'unknown', contentBase64: 'AA==' }] }),
      (error: any) => { assert.equal(error.getStatus(), 429); assert.deepEqual(error.getResponse(), { code: 'AI_BUDGET_INSUFFICIENT', budgetScope: 'TOTAL' }); return true; });
  } finally { globalThis.fetch = original; }
  assert.equal(state.usedCount(), 0); assert.equal(state.events.length, 0);
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
      company: { findUnique: async () => null },
      companyAiConfiguration: { findUnique: async () => null },
      companyAiMonthlyUsage: { findUnique: async () => ({ costSatang: spend }) },
      companyAiMonthlyBucketUsage: { findUnique: async () => null },
      $transaction: async (fn: (tx: any) => Promise<any>) => fn({
        aiUsageEvent: { createMany: async (args: any) => { recorded.push(...args.data); return { count: args.data.length }; } },
        companyAiMonthlyUsage: { upsert: async () => ({ costSatang: spend }) },
        companyAiMonthlyBucketUsage: { findUnique: async () => null },
      }),
    };
    return { prisma: { client } as any, recorded, setSpend: (value: number) => { spend = value; } };
  }

  async function turnWith(prisma: unknown, onFetch?: () => void,
    options?: Parameters<AiGatewayClient['requestLineTurn']>[1]): Promise<{ error: unknown; calls: number }> {
    const client = new AiGatewayClient(budgetConfig, delegation, undefined, prisma as any);
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      onFetch?.();
      return { ok: true, json: async () => ({ requestId: 'request-1', usage: [usageRow] }) } as Response;
    };
    try {
      await client.requestLineTurn(turnRequest, options);
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
        company: { findUnique: async () => null },
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

  // Owner 2026-09-30 ("ข้อความตอนเครดิตหมดระหว่างส่งซ้ำ ต้องยอมให้ใช้เกินโควต้า").
  it('admits the ledger drain retry past the cap and meters it like any turn; the live call still refuses', async () => {
    const meter = meterPrisma(200_000);

    const retry = await turnWith(meter.prisma, undefined, { retryOrdinal: 1, admitOverCap: true });
    assert.equal(retry.error, undefined, 'the retry gets its real answer');
    assert.equal(retry.calls, 1);
    assert.equal(meter.recorded.length, 1, 'and its usage is recorded exactly once, like any other turn');

    const { error: liveError, calls: liveCalls } = await turnWith(meter.prisma);
    assert.ok(liveError instanceof HttpException);
    assert.deepEqual(liveError.getResponse(), { code: 'AI_MONTHLY_BUDGET_EXCEEDED', budgetScope: 'TOTAL' });
    assert.equal(liveCalls, 0);
  });

  it('routes a text message accepted before the credit ran out past the cap, metered once; a fresh one is refused', async () => {
    const meter = meterPrisma(200_000);
    const client = new AiGatewayClient(budgetConfig, delegation, undefined, meter.prisma);
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return { ok: true, json: async () => ({ status: 'ROUTED', intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 1, usage: [usageRow] }) } as Response;
    };
    const intake = { requestId: 'intake-1', webhookEventId: 'event-1', companyId: 'company-1', userId: 'user-1',
      locale: 'th-TH' as const, messageText: 'ยอดขายวันนี้', permissions: [] };
    try {
      await assert.rejects(client.requestLineIntakeRoute(intake), (error: unknown) => error instanceof HttpException
        && (error.getResponse() as { code?: string }).code === 'AI_MONTHLY_BUDGET_EXCEEDED');
      assert.equal(calls, 0);
      assert.equal((await client.requestLineIntakeRoute(intake, { admitOverCap: true })).status, 'ROUTED');
      assert.equal(calls, 1);
      assert.equal(meter.recorded.length, 1, 'metered exactly once');
    } finally { globalThis.fetch = originalFetch; }
  });

  it('still refuses the drain retry when the meter itself cannot be read', async () => {
    const broken = { client: {
      company: { findUnique: async () => null },
      companyAiConfiguration: { findUnique: async () => null },
      companyAiMonthlyUsage: { findUnique: async () => { throw new Error('DB_DOWN'); } },
    } };
    const { error, calls } = await turnWith(broken, undefined, { retryOrdinal: 1, admitOverCap: true });
    assert.ok(error instanceof HttpException);
    assert.deepEqual(error.getResponse(), { code: 'AI_BUDGET_UNAVAILABLE', budgetScope: 'TOTAL' });
    assert.equal(calls, 0);
  });
});

// ── Phase E1b: SPLIT admission, envelopes and attempt identities ─────────────

describe('AiGatewayClient SPLIT admission (spec §12.3/§12.6, ADR 0013 §4/§6)', () => {
  const HAIKU = SPLIT_FIXTURE_MODEL_ID;
  const splitConfig = (over: Record<string, unknown> = {}) => ({
    aiGatewayInternalUrl: 'http://ai-gateway.test/v1',
    aiGatewayInternalSecret: 'workload-secret',
    aiThbPerUsd: 33,
    aiMonthlyBudgetSatang: 200_000,
    approvedAiModelIds: [HAIKU],
    isProduction: false,
    ...over,
  }) as any;
  const delegation = { issue: () => 'signed' } as any;

  /** Captures the body the client actually puts on the wire. */
  function captureFetch(response: unknown, ok = true) {
    const bodies: any[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = async (_url: any, init: any) => {
      bodies.push(JSON.parse(init.body));
      return { ok, status: ok ? 200 : 400, json: async () => response } as Response;
    };
    return { bodies, restore: () => { globalThis.fetch = original; } };
  }

  beforeEach(__resetCompanyAiBudgetCache);

  const turnRequest = (over: Record<string, unknown> = {}): LineAiTurnRequest => ({
    requestId: 'transport-1', webhookEventId: 'evt-9001',
    userContext: { lineUserId: '[REDACTED]', internalUserId: 'u1', companyId: 'company-1',
      membershipId: 'm1', permissions: [], roles: ['INVENTORY'], locale: 'th-TH' } as any,
    // The live webhook path resolves this before building the request (`process-line-webhook`
    // :4801); under SPLIT it is what the envelope pins the model to.
    modelPolicy: { modelId: HAIKU }, messageText: 'ยอดขายวันนี้', messagePreviewHash: 'hash', ...over,
  });

  const usageRow = { tag: 'line.loop', modelId: HAIKU, ok: true, inputTokens: 100, outputTokens: 10,
    cacheReadInputTokens: 0, cacheWriteInputTokens: 0, usageBasis: 'PROVIDER_REPORTED' };

  it('puts the bounded envelope on the wire and settles the invocation it names', async () => {
    const { prisma, reservations, events } = splitPrisma({ total: 100_000, chat: 50_000, ocr: 50_000 });
    const client = new AiGatewayClient(splitConfig(), delegation, undefined, prisma);
    const fetchStub = captureFetch({ requestId: 'transport-1', usage: [usageRow] });
    try {
      await client.requestLineTurn(turnRequest());
    } finally { fetchStub.restore(); }

    const envelope = fetchStub.bodies[0].budgetEnvelope;
    assert.ok(envelope, 'the request carries a budgetEnvelope');
    assert.equal(envelope.stepKind, 'line-turn');
    assert.equal(envelope.bucket, 'CHAT');
    assert.equal(envelope.modelId, HAIKU);
    assert.equal(envelope.maxCalls, AI_BUDGET_STEP_BOUNDS['line-turn'].maxCalls);
    assert.deepEqual(envelope.bounds, AI_BUDGET_STEP_BOUNDS['line-turn']);
    // The fencing token is API-only and must NEVER ride on the wire.
    assert.equal(JSON.stringify(fetchStub.bodies[0]).includes('ownerToken'), false);

    const hold = [...reservations.values()][0];
    assert.equal(hold.status, 'SETTLED', 'the hold is closed by the invocation evidence');
    assert.equal(events.size, 1);
    assert.equal([...events.values()][0].budgetBucket, 'CHAT');
    assert.equal([...events.values()][0].invocationKey, envelope.invocationKey);
  });

  it('derives the attempt key from the ORIGINAL webhook event, hashed — never the transport id', async () => {
    const { prisma, reservations } = splitPrisma({ total: 100_000, chat: 50_000, ocr: 50_000 });
    const client = new AiGatewayClient(splitConfig(), delegation, undefined, prisma);
    const fetchStub = captureFetch({ requestId: 'transport-1', usage: [usageRow] });
    try {
      await client.requestLineTurn(turnRequest());
    } finally { fetchStub.restore(); }

    const hold = [...reservations.values()][0];
    assert.equal(hold.attemptKey, `line-text:${aiBudgetAttemptHash('evt-9001')}`);
    assert.equal(hold.attemptKey.includes('transport-1'), false, 'the transport id is not the attempt');
    assert.equal(hold.attemptKey.includes('evt-9001'), false, 'the raw LINE id is hashed');
    assert.equal(hold.invocationKey, `company-1#${hold.attemptKey}#line-turn#0`);
  });

  it('derives a TEXT intake attempt from the webhook event when the caller sends one (E1c)', async () => {
    // E1b left this open: `LineIntakeRouteRequest` carried no webhook id, so a redelivery under a
    // fresh transport id bought a SECOND hold for the same message. E1c added the contract field.
    const { prisma, reservations } = splitPrisma({ total: 100_000, chat: 50_000, ocr: 50_000 });
    const client = new AiGatewayClient(splitConfig(), delegation, undefined, prisma);
    const fetchStub = captureFetch({ status: 'ROUTED', intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 1 });
    try {
      await client.requestLineIntakeRoute({
        requestId: 'transport-77', webhookEventId: 'evt-9001', companyId: 'company-1', userId: 'u1',
        locale: 'th-TH', messageText: 'ดูค่าใช้จ่ายเดือนนี้', permissions: ['ai.tool.invoke', 'expense.read'],
        enabledFeatures: ['expenses', 'expenses.list'], offeredToolNames: ['expense.list_recent'],
      });
    } finally { fetchStub.restore(); }

    const hold = [...reservations.values()][0];
    assert.ok(hold, 'a SPLIT text intake must be ADMITTED, not refused for a model nobody resolved');
    assert.equal(hold.pricingSnapshot.modelId, HAIKU, 'the text lane prices the tenant approved model');
    assert.equal(hold.stepKind, 'line-intake-text');
    assert.equal(hold.attemptKey, `line-text:${aiBudgetAttemptHash('evt-9001')}`);
    assert.equal(hold.attemptKey.includes('transport-77'), false, 'the transport id is not the attempt');
    assert.equal(hold.attemptKey.includes('evt-9001'), false, 'the raw LINE id is hashed');
    // The gateway must be able to rebuild the fence from the body it received.
    assert.equal(hold.invocationKey, `company-1#${hold.attemptKey}#line-intake-text#0`);
    // And the field itself is inert on the wire: the intake router builds its prompt from an
    // explicit allowlist, so it never becomes model input.
    assert.equal(fetchStub.bodies[0].webhookEventId, 'evt-9001');
    assert.deepEqual(fetchStub.bodies[0].offeredToolNames, ['expense.list_recent'], 'authority catalog survives API→Gateway JSON transport');
  });

  it('keeps the request-id fallback for an intake caller that sends no webhook event', async () => {
    const { prisma, reservations } = splitPrisma({ total: 100_000, chat: 50_000, ocr: 50_000 });
    const client = new AiGatewayClient(splitConfig(), delegation, undefined, prisma);
    const fetchStub = captureFetch({ status: 'ROUTED', intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 1 });
    try {
      await client.requestLineIntakeRoute({
        requestId: 'transport-77', companyId: 'company-1', userId: 'u1',
        locale: 'th-TH', messageText: 'ยอดขายวันนี้', permissions: [],
      });
    } finally { fetchStub.restore(); }

    assert.equal([...reservations.values()][0].attemptKey, `line-text:${aiBudgetAttemptHash('transport-77')}`);
  });

  it('a drain reclaim is the same webhook event at the next retry ordinal (R-03)', async () => {
    const { prisma, reservations } = splitPrisma({ total: 100_000, chat: 50_000, ocr: 50_000 });
    const client = new AiGatewayClient(splitConfig(), delegation, undefined, prisma);
    const fetchStub = captureFetch({ requestId: 'transport-2', usage: [usageRow] });
    try {
      await client.requestLineTurn(turnRequest(), { retryOrdinal: 2 });
    } finally { fetchStub.restore(); }

    const hold = [...reservations.values()][0];
    assert.equal(hold.attemptKey, `line-text:${aiBudgetAttemptHash('evt-9001')}:r2`);
  });

  it('releases the hold when the GATEWAY refused this invocation before its provider (E1c)', async () => {
    // The gateway's own guard (a model or bound outside the envelope, or an envelope that did not
    // validate) answers one of OUR codes with NO usage row. Leaving that hold DISPATCHED would let
    // one misdeclared bound close a bucket with nothing spent.
    const { prisma, reservations, events } = splitPrisma({ total: 100_000, chat: 50_000, ocr: 50_000 });
    const client = new AiGatewayClient(splitConfig(), delegation, undefined, prisma);
    const fetchStub = captureFetch({ requestId: 'transport-1', errorCode: 'AI_BUDGET_UNAVAILABLE' });
    try {
      await assert.rejects(client.requestLineTurn(turnRequest()), (error: any) => error.getStatus() === 429 && error.getResponse().code === 'AI_BUDGET_UNAVAILABLE');
    } finally { fetchStub.restore(); }

    const hold = [...reservations.values()][0];
    assert.equal(hold.status, 'CANCELLED');
    assert.equal((hold.evidenceJson as { proof: string }).proof, 'gateway_pre_provider_refusal');
    assert.equal(events.size, 0, 'nothing was spent, so nothing is billed');
  });

  it('keeps the hold when the refusal came mid-chain, after a call that DID run', async () => {
    // ordinal 0 read, ordinal 1 refused: the response carries the money code AND the read's row.
    // Releasing then would un-bill a real provider call (R-05).
    const { prisma, reservations, events } = splitPrisma({ total: 100_000, chat: 50_000, ocr: 50_000 });
    const client = new AiGatewayClient(splitConfig(), delegation, undefined, prisma);
    const fetchStub = captureFetch({ requestId: 'transport-1', errorCode: 'AI_BUDGET_INSUFFICIENT', usage: [usageRow] });
    try {
      await assert.rejects(client.requestLineTurn(turnRequest()), (error: any) => error.getResponse().code === 'AI_BUDGET_INSUFFICIENT');
    } finally { fetchStub.restore(); }

    const hold = [...reservations.values()][0];
    assert.equal(hold.status, 'SETTLED', 'the invocation that ran is settled, never cancelled');
    assert.equal(events.size, 1);
  });

  it('keeps the hold for a failure that is not a money answer', async () => {
    const { prisma, reservations } = splitPrisma({ total: 100_000, chat: 50_000, ocr: 50_000 });
    const client = new AiGatewayClient(splitConfig(), delegation, undefined, prisma);
    const fetchStub = captureFetch({ requestId: 'transport-1', errorCode: 'ORCHESTRATOR_FAILED' });
    try {
      await client.requestLineTurn(turnRequest());
    } finally { fetchStub.restore(); }

    // Unknown provider cost: the hold stays and becomes UNRESOLVED, which is the designed
    // conservative outcome — money is never released on a guess.
    assert.equal([...reservations.values()][0].status, 'DISPATCHED');
  });

  it('a CHAT-exhausted company gets AI_MONTHLY_BUDGET_EXCEEDED scoped to CHAT and no provider call', async () => {
    // CHAT is spent to its cap; OCR is untouched. The refusal must name CHAT, not the TOTAL.
    const { prisma } = splitPrisma({ total: 100_000, chat: 1_000, ocr: 50_000, spentChat: 1_000 });
    const client = new AiGatewayClient(splitConfig(), delegation, undefined, prisma);
    const fetchStub = captureFetch({});
    let error: unknown;
    try {
      await client.requestLineTurn(turnRequest());
    } catch (err) { error = err; } finally { fetchStub.restore(); }

    assert.ok(error instanceof HttpException);
    assert.deepEqual(error.getResponse(), { code: 'AI_MONTHLY_BUDGET_EXCEEDED', budgetScope: 'CHAT' });
    assert.equal(fetchStub.bodies.length, 0, 'no provider call on a money refusal');
  });

  it('a near-limit CHAT says AI_BUDGET_INSUFFICIENT, never "full" (E-06)', async () => {
    // Money is LEFT (1 satang under the line-turn bound), so this is insufficient, not exceeded.
    const bound = 44; // haiku 'line-turn' at FX 33, from the asserted feasibility table
    const { prisma } = splitPrisma({ total: 100_000, chat: bound + 1, ocr: 50_000, spentChat: 2 });
    const client = new AiGatewayClient(splitConfig(), delegation, undefined, prisma);
    const fetchStub = captureFetch({});
    let error: unknown;
    try {
      await client.requestLineTurn(turnRequest());
    } catch (err) { error = err; } finally { fetchStub.restore(); }

    assert.ok(error instanceof HttpException);
    assert.deepEqual(error.getResponse(), { code: 'AI_BUDGET_INSUFFICIENT', budgetScope: 'CHAT' });
  });

  // Owner 2026-09-30 ("ข้อความตอนเครดิตหมดระหว่างส่งซ้ำ ต้องยอมให้ใช้เกินโควต้า").
  for (const [label, policy] of [
    ['a full CHAT (exceeded)', { total: 100_000, chat: 1_000, ocr: 50_000, spentChat: 1_000 }],
    ['a near-limit CHAT (insufficient)', { total: 100_000, chat: 45, ocr: 50_000, spentChat: 2 }],
  ] as const) {
    it(`admits the ledger drain retry past ${label}, marks the hold for the turn's further calls, and settles it once`, async () => {
      const { prisma, reservations, events } = splitPrisma({ ...policy });
      const client = new AiGatewayClient(splitConfig(), delegation, undefined, prisma);
      const fetchStub = captureFetch({ requestId: 'transport-1', usage: [usageRow] });
      try {
        await client.requestLineTurn(turnRequest(), { retryOrdinal: 1, admitOverCap: true });
      } finally { fetchStub.restore(); }

      assert.equal(fetchStub.bodies.length, 1, 'the retry reaches the provider for its real answer');
      assert.ok(fetchStub.bodies[0].budgetEnvelope, 'under the same bounded envelope as any hold');
      const hold = [...reservations.values()][0];
      assert.equal(hold.attemptKey, `line-text:${aiBudgetAttemptHash('evt-9001')}:r1`);
      assert.equal(hold.pricingSnapshot.admitOverCap, true, 'budget-step reads this for the rest of the turn');
      assert.equal(hold.status, 'SETTLED');
      assert.equal(events.size, 1, 'usage recorded exactly once');
    });
  }

  // Owner 2026-09-30 ("ไม่ทำต่อ"): a CHAT part an admin closed (cap 0) is never passed, not even by a retry.
  it('refuses the drain retry when an admin closed the CHAT part (cap 0), with no hold left behind', async () => {
    const { prisma, reservations } = splitPrisma({ total: 100_000, chat: 0, ocr: 50_000 });
    const client = new AiGatewayClient(splitConfig(), delegation, undefined, prisma);
    const fetchStub = captureFetch({});
    let error: unknown;
    try {
      await client.requestLineTurn(turnRequest(), { retryOrdinal: 1, admitOverCap: true });
    } catch (err) { error = err; } finally { fetchStub.restore(); }

    assert.ok(error instanceof HttpException);
    assert.deepEqual(error.getResponse(), { code: 'AI_MONTHLY_BUDGET_EXCEEDED', budgetScope: 'CHAT' });
    assert.equal(fetchStub.bodies.length, 0);
    assert.equal(reservations.size, 0);
  });

  it('an OCR-insufficient image intake reports the OCR scope while CHAT stays open (E-02)', async () => {
    const { prisma } = splitPrisma({ total: 100_000, chat: 50_000, ocr: 10, spentOcr: 1 });
    const client = new AiGatewayClient(splitConfig(), delegation, undefined, prisma);
    const fetchStub = captureFetch({});
    let error: unknown;
    try {
      await client.requestLineIntakeRoute({
        requestId: 'intake-1', companyId: 'company-1', userId: 'u1', locale: 'th', messageText: '',
        permissions: [],
        attachments: [{ id: 'line-msg-77', mimeType: 'image/jpeg', contentBase64: 'AAA', purpose: 'receipt' }],
      } as any);
    } catch (err) { error = err; } finally { fetchStub.restore(); }

    assert.ok(error instanceof HttpException);
    assert.deepEqual(error.getResponse(), { code: 'AI_BUDGET_INSUFFICIENT', budgetScope: 'OCR' });
    assert.equal(fetchStub.bodies.length, 0);
  });

  it('a SPLIT turn with no pinned model cannot start — never an unmetered pass (F-07)', async () => {
    const { prisma } = splitPrisma({ total: 100_000, chat: 50_000, ocr: 50_000 });
    const client = new AiGatewayClient(splitConfig(), delegation, undefined, prisma);
    const fetchStub = captureFetch({});
    let error: unknown;
    try {
      // A company inheriting the platform default model: the API cannot name it, so the envelope
      // cannot pin it and the reservation refuses rather than holding money for an unknown model.
      await client.requestLineTurn(turnRequest({ modelPolicy: undefined }));
    } catch (err) { error = err; } finally { fetchStub.restore(); }

    assert.ok(error instanceof HttpException);
    assert.deepEqual(error.getResponse(), { code: 'AI_BUDGET_UNAVAILABLE', budgetScope: 'TOTAL' });
    assert.equal(fetchStub.bodies.length, 0);
  });

  it('R-05: an OCR count refusal releases the hold; a retryable provider failure does NOT', async () => {
    const receipt = {
      requestId: 'ocr-1', companyId: 'company-1', userId: 'u1', activeCategories: [],
      attachment: { id: 'line-msg-88', mimeType: 'image/jpeg', purpose: 'receipt', contentBase64: 'AAA' },
    } as any;

    // (a) the count gate refuses BEFORE any HTTP call -> proven no provider -> the hold is cancelled.
    const refusedCount = splitPrisma({ total: 100_000, chat: 50_000, ocr: 50_000 });
    const clientA = new AiGatewayClient(splitConfig(), delegation, undefined, refusedCount.prisma);
    const fetchA = captureFetch({});
    try {
      // `ocrEnabled: false` on the configuration row is the switch `admitCompanyOcr` refuses on.
      refusedCount.prisma.client.companyAiConfiguration.findUnique = async () => ({
        modelId: HAIKU, monthlyBudgetSatang: 100_000, budgetMode: 'SPLIT',
        chatMonthlyBudgetSatang: 50_000, ocrMonthlyBudgetSatang: 50_000,
        budgetConfigVersion: 1, pendingBudgetPolicy: null, ocrEnabled: false,
      });
      const result = await clientA.requestReceiptOcr(receipt);
      // The count/switch gate answered with its OWN vocabulary (this fake has no OCR tables, so it
      // is the unavailable branch); what matters is that it refused BEFORE the HTTP call.
      assert.ok(['OCR_FEATURE_DISABLED', 'OCR_QUOTA_UNAVAILABLE'].includes(result.errorCode!), result.errorCode);
    } finally { fetchA.restore(); }
    assert.equal(fetchA.bodies.length, 0, 'the count gate refused before the HTTP call');
    assert.equal([...refusedCount.reservations.values()][0].status, 'CANCELLED');
    assert.equal([...refusedCount.reservations.values()][0].evidenceJson.proof, 'ocr_admission_refused');

    // (b) the provider RAN and failed retryably: the read count is refunded, the money is not.
    const failedProvider = splitPrisma({ total: 100_000, chat: 50_000, ocr: 50_000 });
    const clientB = new AiGatewayClient(splitConfig(), delegation, undefined, failedProvider.prisma);
    const fetchB = captureFetch({ status: 'failed', errorCode: 'OCR_EXTRACTION_EMPTY', usage: [usageRow] });
    try {
      await clientB.requestReceiptOcr(receipt, { ocrAlreadyAdmitted: true });
    } finally { fetchB.restore(); }
    assert.equal(fetchB.bodies.length, 1, 'the provider was called');
    const hold = [...failedProvider.reservations.values()][0];
    assert.notEqual(hold.status, 'CANCELLED', 'a provider failure NEVER refunds money (R-05)');
    assert.equal(hold.status, 'SETTLED', 'it settles against the usage the gateway reported');
  });
});


describe('AiGatewayClient v2 transport', () => {
  it('builds full SHA-256 QA evidence before authenticated document transport', async () => {
    const sha = (value: string) => createHash('sha256').update(value).digest('hex'), now = Date.now();
    const question = 'หน้า 1 ยอดรวมเท่าไร', jobId = 'qa-job', source = 'rendered page';
    const pages = [{ attachmentId: 'attachment-1', page: 1, sourceMimeType: 'application/pdf' as const, mimeType: 'image/png' as const,
      contentHash: sha('source PDF'), renderedSha256: sha(source), contentBase64: Buffer.from(source).toString('base64') }];
    const inputDigest = sha(lineDocumentQaInputEvidenceText(question, pages));
    const grant = { version: 2 as const, turnKey: 'qa-turn', authorityKind: 'qa_job' as const, authorityId: jobId, channelOwnerDigest: sha('owner'),
      attemptKey: 'qa-attempt', monthKey: '2026-09', payerCompanyId: 'company-1', model: { provider: 'bedrock' as const, modelId: SPLIT_FIXTURE_MODEL_ID, region: 'ap-southeast-1' },
      allowedProfileIds: ['document-qa/2' as const], profileTableDigest: AI_BUDGET_PROFILE_TABLE_DIGEST_V2, maxTurnSlots: 2 as const, maxRepairs: 1 as const,
      admittedAtMs: now, workDeadlineAtMs: now + 897000, finalDeadlineAtMs: now + 900000, nonce: 'qa-nonce', nextOrdinal: 1, issuerVersion: 'fixture', signature: sha('signature') };
    let validated = 0;
    const client = new AiGatewayClient({ aiGatewayInternalUrl: 'http://ai-gateway.test/v1', aiGatewayInternalSecret: 'synthetic' } as any,
      { issue: () => { throw new Error('QA must not issue a business delegation'); } } as any, undefined,
      { client: new Proxy({}, { get: () => { throw new Error('QA must not create a legacy hold or duplicate usage'); } }) } as any,
      { validate: async (received: unknown, digest: string, scope: unknown) => {
        validated++; assert.deepEqual(received, grant); assert.equal(digest, inputDigest);
        assert.deepEqual(scope, { companyId: 'company-1', userId: 'user-1' }); return true;
      } } as any);
    const input = { requestId: 'qa-request', companyId: 'company-1', userId: 'user-1', jobId, jobRevision: 1, turnId: grant.turnKey,
      question, pages, inputDigest, inputSetHash: sha('input-set'), questionDigest: sha(question), readerVersion: 'line-document-qa/1' as const, budgetGrantV2: grant };
    const original = globalThis.fetch; let calls = 0;
    globalThis.fetch = async (url, init) => {
      calls++; assert.match(String(url), /\/internal\/ai\/line-document-qa$/);
      const request = JSON.parse(String(init?.body)), evidence = await verifyLineAiInputEvidence(request.inputEvidence, request.messageText);
      assert.ok(evidence); assert.equal(evidence.parts[0]!.eventIdHash, sha(jobId));
      assert.equal(evidence.joinedSha256, inputDigest); assert.deepEqual(request.pages, pages);
      assert.deepEqual(request.budgetGrantV2, grant); assert.equal(request.budgetEnvelope, undefined);
      return new Response(JSON.stringify({ status: 'failed', errorCode: 'SYNTHETIC_TRANSPORT_REACHED' }));
    };
    try {
      assert.deepEqual(await client.requestLineDocumentQa(input), { status: 'failed', errorCode: 'SYNTHETIC_TRANSPORT_REACHED' });
      assert.equal(calls, 1); assert.equal(validated, 1);
      assert.deepEqual(await client.requestLineDocumentQa({ ...input, inputDigest: sha('different manifest') }), { status: 'failed', errorCode: 'QA_INPUT_DIGEST_MISMATCH' });
      assert.equal(calls, 1, 'a transplanted manifest must still fail before transport');
      assert.equal(aiBudgetAttemptHash(jobId).length, 32, 'reservation identity helper remains unchanged');
    } finally { globalThis.fetch = original; }
  });

  it('forwards authenticated evidence with the pinned model and no legacy hold or duplicate usage metering', async () => {
    const built = await createLineAiInputEvidence({ turnKey: 'v2-transport', parts: [{ partId: 'one', eventIdHash: 'a'.repeat(64), acceptedAtMs: Date.now(), rawText: baseTurnRequest.messageText }] });
    assert.ok(built);
    const now = Date.now();
    const grant = { version: 2 as const, turnKey: 'v2-transport', authorityKind: 'webhook_event' as const, authorityId: 'authority', channelOwnerDigest: 'b'.repeat(64),
      attemptKey: 'attempt-transport', monthKey: '2026-09', payerCompanyId: 'company-1', model: { provider: 'bedrock' as const, modelId: SPLIT_FIXTURE_MODEL_ID, region: 'ap-southeast-1' },
      allowedProfileIds: ['line-answer/2'] as const, profileTableDigest: AI_BUDGET_PROFILE_TABLE_DIGEST_V2, maxTurnSlots: 2 as const, maxRepairs: 1 as const,
      admittedAtMs: now, workDeadlineAtMs: now + 10000, finalDeadlineAtMs: now + 13000, nonce: 'transport', nextOrdinal: 0, issuerVersion: 'fixture', signature: 'c'.repeat(64) };
    let validated = 0;
    const client = new AiGatewayClient({ aiGatewayInternalUrl: 'http://ai-gateway.test/v1', aiGatewayInternalSecret: 'synthetic' } as any,
      { issue: () => { throw new Error('no business delegation authorized'); } } as any, undefined,
      { client: new Proxy({}, { get: (_target, key) => { if (key === 'company') return { findUnique: async () => null }; throw new Error('legacy budget/meter path must not run'); } }) } as any,
      { validate: async (received: unknown, digest: string, scope: unknown) => { validated++; assert.deepEqual(received, grant);
        assert.equal(digest, built.inputEvidence.joinedSha256); assert.deepEqual(scope, { companyId: 'company-1', userId: 'user-1', membershipId: 'membership-1' }); return true; } } as any);
    const original = globalThis.fetch; let sent: any;
    globalThis.fetch = async (_url, init) => { sent = JSON.parse(String(init?.body)); return new Response(JSON.stringify({ status: 'ok', replyText: 'synthetic', usage: [{ inputTokens: 123 }] })); };
    try {
      const result = await client.requestLineTurn({ ...baseTurnRequest, inputEvidence: built.inputEvidence,
        contractCapabilities: ['input-evidence-v2', 'budget-envelope-v2'], budgetGrantV2: { ...grant, allowedProfileIds: [...grant.allowedProfileIds] } });
      assert.equal(result.replyText, 'synthetic'); assert.equal(validated, 1);
      assert.deepEqual(sent.budgetGrantV2, grant); assert.equal(sent.budgetEnvelope, undefined);
      assert.deepEqual(sent.modelPolicy, { modelId: SPLIT_FIXTURE_MODEL_ID }); assert.deepEqual(sent.inputEvidence, built.inputEvidence);
    } finally { globalThis.fetch = original; }
  });
});


describe('SHARED LINE failed-call accounting', () => {
  it('absorbs timeouts while retaining every provider call, including calls sharing a request identity', async () => {
    const events: any[] = [];
    let aggregateWrites = 0;
    const modelId = SPLIT_FIXTURE_MODEL_ID;
    const tx = {
      aiUsageEvent: { createMany: async ({ data }: any) => {
        events.push(...data);
        return { count: data.length };
      } },
      companyAiMonthlyUsage: { upsert: async () => { aggregateWrites += 1; return { costSatang: 0 }; } },
    };
    const prisma = { client: {
      companyAiConfiguration: { findUnique: async () => ({ modelId, budgetMode: 'SHARED', monthlyBudgetSatang: 100_000 }) },
      companyAiMonthlyUsage: { findUnique: async () => ({ costSatang: 0 }) },
      companyAiMonthlyBucketUsage: { findUnique: async () => null },
      $transaction: async (fn: any) => fn(tx),
    } } as any;
    const config = { aiGatewayInternalUrl: 'http://gateway.test/v1', aiGatewayInternalSecret: 'secret',
      approvedAiModelIds: [modelId], aiMonthlyBudgetSatang: 100_000, aiThbPerUsd: 33 } as any;
    const client = new AiGatewayClient(config, { issue: () => 'signed' } as any, undefined, prisma);
    const request = { requestId: 'transport-1', companyId: 'shared-nocharge', userId: 'user-1',
      attachment: { id: 'image-1', mimeType: 'image/jpeg', purpose: 'receipt', contentBase64: 'aGVsbG8=' } } as const;
    const result = { status: 'failed', errorCode: 'PROVIDER_TIMEOUT', usage: [{ tag: 'ocr.receipt.image-read', modelId, ok: false,
      inputTokens: 1200, outputTokens: 100, cacheReadInputTokens: 0, cacheWriteInputTokens: 0,
      durationMs: 1, usageBasis: 'CONSERVATIVE_ESTIMATE' }] };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify(result), { status: 200 });
    try {
      assert.deepEqual(await client.requestReceiptOcr(request, { ocrAlreadyAdmitted: true, retryWebhookEventId: 'event-1' }), result);
      await client.requestReceiptOcr(request, { ocrAlreadyAdmitted: true, retryWebhookEventId: 'event-1' });
      assert.equal(events.length, 2);
      assert.ok(events.every(event => event.invocationKey === undefined));
      assert.equal(events[0].usageBasis, 'COMPANY_ABSORBED');
      assert.ok(events[0].costSatang > 0);
      assert.equal(aggregateWrites, 0);
      await client.requestReceiptOcr({ ...request, requestId: 'real-retry' }, { ocrAlreadyAdmitted: true, retryWebhookEventId: 'event-2' });
      assert.equal(events.length, 3);
      await client.requestReceiptOcr({ ...request, attachment: { ...request.attachment, id: 'image-2' } },
        { ocrAlreadyAdmitted: true, retryWebhookEventId: 'event-1' });
      assert.equal(events.length, 4, 'different attachments in one event are also retained');
    } finally { globalThis.fetch = originalFetch; }
  });
});

it('gives signed image intake enough time for a page and one timeout retry', async () => {
  const { LineAiBudgetAuthorityService } = await import('../application/line-ai-budget-authority.service');
  const { aiGatewayClientTimeoutMs, AI_BUDGET_PROFILES_V2 } = await import('@watchdog-bms/contracts');
  const model = { provider: 'bedrock' as const, modelId: 'fixture-model', region: 'ap-southeast-1' };
  const owner = { kind: 'PRIVATE' as const, epoch: 1, owner: { companyId: 'co', userId: 'user', membershipId: 'member',
    messagingChannelId: 'channel', chatKeyHash: 'chat', channelKind: 'USER' as const, channel: 'line' as const } };
  const tx = { $executeRaw: async () => 1,
    lineWebhookEventLog: { findUnique: async () => ({ id: 'event', companyId: 'co', status: 'processing', budgetAuthorityRevision: 0 }), updateMany: async () => ({ count: 1 }) },
    companyMembership: { findFirst: async () => ({ id: 'member' }) },
    aiConversation: { findFirst: async () => ({ id: 'conversation' }) },
  };
  const service = new LineAiBudgetAuthorityService({ client: { $transaction: async (fn: any) => fn(tx) } } as any,
    { approvedAiModelIds: ['fixture-model'], aiGatewayInternalSecret: 'fixture', lineMessagingChannelId: 'channel' } as any);
  const now = new Date();
  for (const requestKind of ['TEXT', 'IMAGE'] as const) {
    const grant = await service.issue({ authorityKind: 'webhook_event', authorityId: 'event', owner, turnKey: 'turn', attemptKey: 'attempt',
      inputDigest: 'a'.repeat(64), requestKind, admittedAtMs: now.getTime(), coalescingExtraMs: 0, lane: 'public', model,
      modelContextTokens: 200000, modelMaxOutputTokens: 8192,
      tariff: { version: 'fixture:1', ...model, thbPerUsd: 35, usdPerMTok: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 } },
      allowedProfileIds: [requestKind === 'IMAGE' ? 'line-intake-image/2' : 'line-intake-text/2'] }, now);
    assert.ok(grant);
    assert.equal(grant.finalDeadlineAtMs - now.getTime(), requestKind === 'IMAGE' ? aiGatewayClientTimeoutMs(2) : 40000);
    if (requestKind === 'IMAGE') assert.ok(grant.workDeadlineAtMs - now.getTime() > 2 * 90000);
  }
  assert.equal(AI_BUDGET_PROFILES_V2['line-intake-image/2'].maxCalls, 2);
});

describe('U1b unreachable runtime never reserves or debits customer credit', () => {
  for (const outcome of ['probe timeout', 'runtime unavailable', 'runtime not ready']) it(outcome, async () => {
    const fixture = splitPrisma({ total: 10000, chat: 5000, ocr: 5000 });
    const before = structuredClone(fixture.monthUsage);
    let issued = 0;
    const client = new AiGatewayClient({ aiGatewayInternalUrl: 'http://gateway.test', aiGatewayInternalSecret: 'secret', approvedAiModelIds: [SPLIT_FIXTURE_MODEL_ID], aiThbPerUsd: 33 } as any,
      {} as any, undefined, fixture.prisma, { issue: async () => { issued++; assert.fail('no authority may be issued after a failed capability probe'); } } as any);
    const original = globalThis.fetch;
    globalThis.fetch = async () => {
      if (outcome === 'probe timeout') throw Object.assign(new Error('startup crash'), { name: 'TimeoutError' });
      return new Response(JSON.stringify({ ready: false, errorCode: 'ROUTER_UNREACHABLE' }), { status: outcome === 'runtime unavailable' ? 503 : 200 });
    };
    try {
      const probe = client.issueLineReliabilityGrant('startup-failure', { owner: { owner: { companyId: 'co' } } } as any);
      if (outcome === 'runtime not ready') assert.equal(await probe, null);
      else await assert.rejects(probe, AiGatewayRequestError);
    } finally { globalThis.fetch = original; }
    assert.equal(issued, 0);
    assert.equal(fixture.reservations.size, 0, 'there is no reservation to leave stranded or release');
    assert.equal(fixture.events.size, 0);
    assert.deepEqual(fixture.monthUsage, before);
  });
});


describe('U1 authenticated body-borne refusal is the same 429 at every gateway response seam', () => {
  for (const path of ['line-intake-route', 'line-turn', 'receipt-ocr']) it(path, async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({ status: 'UNAVAILABLE', errorCode: 'AI_BUDGET_INSUFFICIENT', budgetScope: 'CHAT' }), { status: 200 });
    try {
      const client: any = new AiGatewayClient({ aiGatewayInternalUrl: 'http://gateway.test', aiGatewayInternalSecret: 'secret' } as any, {} as any, undefined, governedPrisma());
      await assert.rejects(client.postInternal(`/internal/ai/${path}`, {}, 'u1-body', 3000), (error: any) => {
        assert.equal(error.getStatus(), 429); assert.deepEqual(error.getResponse(), { code: 'AI_BUDGET_INSUFFICIENT', budgetScope: 'CHAT' }); return true;
      });
    } finally { globalThis.fetch = original; }
  });
});

it('U6 the gateway receives the same active selling terms as the web catalog', async () => {
  const { billingOffer } = await import('@watchdog-bms/contracts');
  const offer = { ...billingOffer('ENTERPRISE_1999', 'month'), priceSatang: 234567 };
  let calls = 0, payload: any;
  const client = new AiGatewayClient({ aiGatewayInternalUrl: 'http://gateway.test', aiGatewayInternalSecret: 'secret' } as any,
    { issue: () => 'signed' } as any, undefined, governedPrisma(), undefined, { catalog: async () => { calls++; return { offers: [offer] }; } } as any);
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, init) => { payload = JSON.parse(String(init?.body)); return new Response('{}', { status: 200 }); };
  try { await client.requestLineTurn({ ...baseTurnRequest, packageOffers: [{ ...offer, priceSatang: 199900 }] }); }
  finally { globalThis.fetch = original; }
  assert.equal(calls, 1); assert.equal(payload.packageOffers[0].priceSatang, 234567, 'caller defaults cannot override the current catalog');
});

it('U1b runtime-unavailable and ROUTER_UNREACHABLE after a v2 grant still have zero debit or stranded hold', async () => {
  const fixture = splitPrisma({ total: 10000, chat: 5000, ocr: 5000 });
  const before = structuredClone(fixture.monthUsage), now = Date.now();
  const grant: any = { version: 2, turnKey: 'runtime-unavailable', authorityKind: 'webhook_event', authorityId: 'event-v2',
    channelOwnerDigest: 'b'.repeat(64), attemptKey: 'attempt-v2', monthKey: '2026-10', payerCompanyId: 'co',
    model: { provider: 'bedrock', modelId: SPLIT_FIXTURE_MODEL_ID, region: 'ap-southeast-1' }, allowedProfileIds: ['line-intake-text/2'],
    profileTableDigest: AI_BUDGET_PROFILE_TABLE_DIGEST_V2, maxTurnSlots: 4, maxRepairs: 1, admittedAtMs: now, workDeadlineAtMs: now + 10000,
    finalDeadlineAtMs: now + 20000, nonce: 'nonce-v2', issuerVersion: 'api-1', signature: 'c'.repeat(64) };
  const client: any = new AiGatewayClient({ aiGatewayInternalUrl: 'http://gateway.test', aiGatewayInternalSecret: 'secret', approvedAiModelIds: [SPLIT_FIXTURE_MODEL_ID] } as any,
    { issue: () => 'signed' } as any, undefined, fixture.prisma);
  client.validateLineV2 = async () => grant;
  const original = globalThis.fetch;
  try {
    for (const errorCode of ['ROUTER_UNREACHABLE', 'AGENTCORE_INVOKE_FAILED', 'RUNTIME_UNAVAILABLE']) {
      globalThis.fetch = async () => new Response(JSON.stringify({ errorCode, usage: [] }), { status: 200 });
      await client.requestLineTurn({ ...baseTurnRequest, budgetGrantV2: grant });
      assert.equal(fixture.reservations.size, 0); assert.equal(fixture.events.size, 0); assert.deepEqual(fixture.monthUsage, before);
    }
  } finally { globalThis.fetch = original; }
});

describe('free company gateway boundary', () => {
  it('refuses general turns and intake before model calls or budget holds', async () => {
    let calls = 0;
    let holds = 0;
    const prisma = { client: {
      company: { findUnique: async () => ({ status: 'ACTIVE', archivedAt: null, planTerm: {
        tierKey: 'FREE_TRIAL_15', termEndsAt: new Date(0), billingReceiptAccountId: null, capacityOverride: null,
      } }) },
      billingAccount: { findMany: async () => [] }, billingInvoice: { findFirst: async () => null },
      billingReceiptGrant: { findFirst: async () => null }, packageChangeRequest: { findFirst: async () => null },
      salesAttribution: { findUnique: async () => null },
      $transaction: async () => { holds += 1; throw new Error('unexpected hold'); },
    } } as any;
    const client = new AiGatewayClient({ aiGatewayInternalUrl: 'http://synthetic.invalid', aiGatewayInternalSecret: 'synthetic' } as any,
      { issue: () => 'synthetic' } as any, undefined, prisma);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { calls += 1; throw new Error('unexpected provider'); };
    try {
      await assert.rejects(client.requestLineTurn(baseTurnRequest), (error: any) => error.getResponse?.().code === 'FREE_CHAT_NOT_INCLUDED');
      await assert.rejects(client.requestLineIntakeRoute({ companyId: 'company-1', userId: 'user-1', requestId: 'free-route', text: 'ถามธุรกิจ' } as any), (error: any) => error.getResponse?.().code === 'FREE_CHAT_NOT_INCLUDED');
      assert.equal(calls, 0);
      assert.equal(holds, 0);
    } finally { globalThis.fetch = originalFetch; }
  });
});


it('A1 forwards read-only credit state to the budget authority', async () => {
  let received: unknown;
  const authority = { narrow: async (...args: unknown[]) => { received = args; return null; },
    creditState: async (...args: unknown[]) => { received = args; return { ok: true }; } };
  const client = new AiGatewayClient({} as any, {} as any, undefined, {} as any, authority as any);
  const grant = { signature: 'test' } as any;
  await client.narrowLineReliabilityGrant(grant, 'simple', ['line-answer/2']);
  assert.deepEqual(received, [grant, 'simple', ['line-answer/2']]);
  const now = new Date();
  assert.deepEqual(await client.creditState('company', now), { ok: true });
  assert.deepEqual(received, ['company', now]);
});

it('B4 classify pins Sonnet while the turn keeps its company model and partner policy wins', async () => {
  const original = globalThis.fetch;
  const sonnet = 'global.anthropic.claude-sonnet-4-6', haiku = SPLIT_FIXTURE_MODEL_ID;
  const policies: any[] = [], issued: any[] = [];
  let partner: string | null = null;
  const prisma = governedPrisma();
  prisma.client.companyAiConfiguration.findUnique = async () => ({ modelId: partner });
  const client = new AiGatewayClient({ aiGatewayInternalUrl: 'http://gateway.test/v1', aiGatewayInternalSecret: 'secret',
    approvedAiModelIds: [sonnet, haiku], aiGlobalInferenceProfileApproved: true, aiGlobalInferenceProfileApprovalRef: 'reviewed', aiThbPerUsd: 33 } as any,
    {} as any, undefined, prisma, { issue: async (input: any) => { issued.push(input); return { signature: 'issued' }; } } as any);
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body)); policies.push(body.modelPolicy);
    return new Response(JSON.stringify({ ready: true, inputContractVersion: 2, providerOutputVersion: 2, budgetContractVersion: 2,
      profileTableDigest: AI_BUDGET_PROFILE_TABLE_DIGEST_V2, estimatorVersion: AI_BUDGET_ESTIMATOR_VERSION_V2,
      model: { provider: 'bedrock', modelId: body.modelPolicy?.modelId ?? haiku, region: 'ap-southeast-1', contextTokens: 200000, maxOutputTokens: 4096 } }));
  };
  try {
    const input = { owner: { owner: { companyId: 'company-1' } } } as any;
    await client.issueLineReliabilityGrant('classify', { ...input, authorityKind: 'webhook_classify' });
    await client.issueLineReliabilityGrant('turn', { ...input, authorityKind: 'webhook_event' });
    partner = haiku;
    await client.issueLineReliabilityGrant('partner', { ...input, authorityKind: 'webhook_classify' });
    assert.deepEqual(policies, [{ modelId: sonnet }, undefined, { modelId: haiku }]);
    assert.deepEqual(issued.map(row => row.model.modelId), [sonnet, haiku, haiku]);
  } finally { globalThis.fetch = original; }
});

it('B4 replay reuses a stored classify decision without a second gateway call, and used without decision falls back', async () => {
  const text = 'ส่งใบเบิกของฉันอนุมัติ';
  const built = (await createLineAiInputEvidence({ turnKey: 'cached-turn', parts: [{ partId: 'p', eventIdHash: 'a'.repeat(64), acceptedAtMs: Date.now(), rawText: text }] }))!;
  const grant: any = { version: 2, turnKey: 'cached-turn', authorityKind: 'webhook_classify', authorityId: 'event', channelOwnerDigest: 'a'.repeat(64),
    attemptKey: 'cached-attempt', monthKey: '2026-11', payerCompanyId: 'company-1', model: { provider: 'bedrock', modelId: SPLIT_FIXTURE_MODEL_ID, region: 'ap-southeast-1' },
    allowedProfileIds: ['line-classify/2'], profileTableDigest: AI_BUDGET_PROFILE_TABLE_DIGEST_V2, maxTurnSlots: 2, maxRepairs: 1,
    admittedAtMs: Date.now(), workDeadlineAtMs: Date.now() + 5000, finalDeadlineAtMs: Date.now() + 8000, nonce: 'nonce', issuerVersion: 'test:1', signature: 'b'.repeat(64), nextOrdinal: 0 };
  let decision: any = null, used = false, gatewayCalls = 0, issued = 0;
  const prisma = governedPrisma();
  prisma.client.lineWebhookEventLog = { findUnique: async () => ({ classifyAuthorityJson: issued ? { grant } : null }) };
  const authority = { validate: async () => true, readClassifyState: async () => ({ decision, used }),
    storeClassifyDecision: async (_grant: any, _digest: string, value: any) => decision = value };
  const client = new AiGatewayClient({ aiGatewayInternalSecret: 'secret', aiGatewayInternalUrl: 'http://gateway.test/v1' } as any,
    {} as any, undefined, prisma, authority as any);
  client.issueLineReliabilityGrant = async () => { issued++; return grant; };
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => { assert.match(String(url), /line-workflow-classify$/); gatewayCalls++;
    const body = JSON.parse(String(init?.body));
    assert.equal(body.budgetGrantV2.authorityKind, 'webhook_classify');
    assert.deepEqual(body.budgetGrantV2.allowedProfileIds, ['line-classify/2']);
    assert.deepEqual(body.contractCapabilities, ['input-evidence-v2', 'budget-envelope-v2']);
    return new Response(JSON.stringify({ status: 'CLASSIFIED', label: 'reimbursement_submit', secondLabel: 'none',
      confidence: 0.99, secondConfidence: 0, slots: {}, schemaEnforcement: 'output_config', usage: [], modelId: SPLIT_FIXTURE_MODEL_ID })); };
  try {
    const request = { requestId: 'cached', companyId: 'company-1', userId: 'user-1', locale: 'th-TH' as const, messageText: text, inputEvidence: built.inputEvidence };
    const admission: any = { authorityId: 'event', owner: { kind: 'PRIVATE', owner: { companyId: 'company-1', userId: 'user-1', membershipId: 'member' }, epoch: 1 }, admittedAtMs: Date.now() };
    const first = await client.requestLineWorkflowClassify(request, admission);
    assert.deepEqual(await client.requestLineWorkflowClassify(request, admission), first);
    assert.equal(gatewayCalls, 1);
    assert.equal(issued, 1);
    assert.equal(first.status, 'CLASSIFIED');
    decision = { status: 'UNAVAILABLE', errorCode: 'AI_MONTHLY_BUDGET_EXCEEDED', budgetCode: 'AI_MONTHLY_BUDGET_EXCEEDED', usage: [] };
    await assert.rejects(client.requestLineWorkflowClassify(request, admission), (error: any) => error.getResponse().code === 'AI_MONTHLY_BUDGET_EXCEEDED');
    assert.equal(gatewayCalls, 1, 'replayed credit refusal keeps the same card without another call');
    decision = null; used = true;
    assert.equal((await client.requestLineWorkflowClassify(request, admission)).status, 'UNAVAILABLE');
    assert.equal(gatewayCalls, 1);
  } finally { globalThis.fetch = original; }
});
