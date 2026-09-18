/**
 * The money identity of a capture call (appendix §4.6).
 *
 * A capture read is MANY provider calls for ONE customer document, so the thing that must be exact
 * here is the per-call identity: the declared step kind, an attempt key that names the job AND the
 * chunk, and the OCR bucket — an extract call carries no media at all and would otherwise be
 * billed as chat.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EXPENSE_CAPTURE_CONTRACT_VERSION } from '@watchdog-bms/contracts';
import { classifyAiUsageRequest as classify } from '../../line-ai/application/company-ai-usage-meter';
import { CAPTURE_USAGE_SOURCE_ROUTE, ExpenseCaptureReadClient } from './expense-capture-read.client';

const config = {
  aiGatewayInternalSecret: 'secret',
  aiGatewayInternalUrl: 'http://ai.invalid/v1',
  aiOcrMaxPerCompany: 100,
  aiRateLimitWindowSeconds: 60,
  approvedAiModelIds: [],
  aiMonthlyBudgetSatang: 1_000_000,
  aiThbPerUsd: 35,
  isProduction: false,
} as any;

/** SHARED budget (every company today): admission passes through with no reservation. */
function sharedPrisma() {
  const usage: any[] = [];
  return {
    usage,
    prisma: {
      client: {
        companyAiConfiguration: { findUnique: async () => null },
        companyAiMonthlyUsage: { findUnique: async () => ({ costSatang: 0 }) },
        $transaction: async (fn: (tx: any) => Promise<unknown>) => fn({
          aiUsageEvent: { createMany: async ({ data }: any) => { usage.push(...data); return { count: data.length }; } },
          companyAiMonthlyUsage: { upsert: async ({ create }: any) => ({ costSatang: create.costSatang }) },
        }),
      },
    } as any,
  };
}

function stubGateway(answer: Record<string, unknown>, status = 200) {
  const original = globalThis.fetch;
  const seen: Array<{ url: string; body: any }> = [];
  globalThis.fetch = (async (url: any, init: any) => {
    seen.push({ url: String(url), body: JSON.parse(init.body) });
    return { ok: status === 200, status, json: async () => answer } as any;
  }) as any;
  return { seen, restore: () => { globalThis.fetch = original; } };
}

const chunk = {
  id: 'c2', kind: 'pdf' as const, mimeType: 'application/pdf', contentBase64: 'ZmFrZQ==',
  pageIndexes: [3, 4, 5], fileLabel: 'file-1',
};

describe('ExpenseCaptureReadClient', () => {
  it('names the job AND the chunk in the attempt key, under the declared read step', async () => {
    const state = sharedPrisma();
    const gateway = stubGateway({ status: 'ok', contractVersion: 1, pages: [{ pageIndex: 3, text: 'A', truncated: false, blank: false }] });
    try {
      const client = new ExpenseCaptureReadClient(config, undefined, state.prisma);
      const result = await client.readChunk({
        companyId: 'co-1', userId: 'system', requestId: 'job-1:c2', jobId: 'job-1', fileLabel: 'file-1', chunk,
      });
      assert.equal(result.status, 'ok');
      assert.equal(gateway.seen.length, 1);
      assert.match(gateway.seen[0]!.url, /\/internal\/ai\/capture-read$/);
      assert.equal(gateway.seen[0]!.body.contractVersion, EXPENSE_CAPTURE_CONTRACT_VERSION);
      assert.deepEqual(gateway.seen[0]!.body.chunk.pageIndexes, [3, 4, 5]);
    } finally { gateway.restore(); }
  });

  it('posts a window to the extract route and returns its observations', async () => {
    const state = sharedPrisma();
    const gateway = stubGateway({ status: 'ok', contractVersion: 1, observations: { documents: [], items: [], components: [], totals: [], payments: [], refunds: [], completeness: { itemsTruncated: false, unreadableRows: 0, pagesCovered: [], notes: [] } } });
    try {
      const client = new ExpenseCaptureReadClient(config, undefined, state.prisma);
      const result = await client.extractWindow({
        companyId: 'co-1', userId: 'system', requestId: 'job-1:w1', jobId: 'job-1', windowId: 'w1',
        window: { fileLabel: 'file-1', pageIndexes: [0], pages: [{ pageIndex: 0, text: 'TOTAL 10.00' }] },
      });
      assert.equal(result.status, 'ok');
      assert.match(gateway.seen[0]!.url, /\/internal\/ai\/capture-extract$/);
      assert.equal(gateway.seen[0]!.body.window.pages[0].text, 'TOTAL 10.00');
    } finally { gateway.restore(); }
  });

  it('bills BOTH stages to the OCR bucket, including the one that carries no media', () => {
    assert.equal(classify(CAPTURE_USAGE_SOURCE_ROUTE, 'document').budgetBucket, 'OCR');
    assert.equal(classify(CAPTURE_USAGE_SOURCE_ROUTE, 'image').budgetBucket, 'OCR');
    assert.equal(classify(CAPTURE_USAGE_SOURCE_ROUTE, 'text').budgetBucket, 'OCR',
      'the extract call is part of a document read, not a chat turn');
  });

  it('answers typed when the gateway is unreachable or refuses', async () => {
    const state = sharedPrisma();
    const original = globalThis.fetch;
    globalThis.fetch = (async () => { throw new Error('synthetic timeout'); }) as any;
    try {
      const client = new ExpenseCaptureReadClient(config, undefined, state.prisma);
      const result = await client.readChunk({ companyId: 'co-1', userId: 'system', requestId: 'r', jobId: 'job-1', fileLabel: 'f', chunk });
      assert.equal(result.status, 'failed');
      assert.equal((result as any).errorCode, 'AI_GATEWAY_UNREACHABLE');
    } finally { globalThis.fetch = original; }

    const state2 = sharedPrisma();
    const refused = stubGateway({ status: 'failed', contractVersion: 1, errorCode: 'AI_BUDGET_INSUFFICIENT', budgetScope: 'OCR' });
    try {
      const client = new ExpenseCaptureReadClient(config, undefined, state2.prisma);
      const result = await client.readChunk({ companyId: 'co-1', userId: 'system', requestId: 'r', jobId: 'job-1', fileLabel: 'f', chunk });
      assert.equal(result.status, 'failed');
      assert.equal((result as any).errorCode, 'AI_BUDGET_INSUFFICIENT');
      assert.equal((result as any).budgetScope, 'OCR', 'the runner needs the scope to pause with the right word');
    } finally { refused.restore(); }
  });

  it('refuses before the gateway when the company is over its document rate limit', async () => {
    const state = sharedPrisma();
    const gateway = stubGateway({ status: 'ok', contractVersion: 1, pages: [] });
    try {
      const rateLimits = { consume: async () => ({ allowed: false }) } as any;
      const client = new ExpenseCaptureReadClient(config, rateLimits, state.prisma);
      const result = await client.readChunk({ companyId: 'co-1', userId: 'system', requestId: 'r', jobId: 'job-1', fileLabel: 'f', chunk });
      assert.equal((result as any).errorCode, 'AI_OCR_RATE_LIMITED');
      assert.equal(gateway.seen.length, 0);
    } finally { gateway.restore(); }
  });

  it('answers not_configured rather than posting to a gateway with no secret', async () => {
    const state = sharedPrisma();
    const gateway = stubGateway({ status: 'ok', contractVersion: 1 });
    try {
      const client = new ExpenseCaptureReadClient({ ...config, aiGatewayInternalSecret: '' }, undefined, state.prisma);
      const result = await client.extractWindow({
        companyId: 'co-1', userId: 'system', requestId: 'r', jobId: 'job-1', windowId: 'w1',
        window: { fileLabel: 'f', pageIndexes: [0], pages: [{ pageIndex: 0, text: 'x' }] },
      });
      assert.equal(result.status, 'not_configured');
      assert.equal(gateway.seen.length, 0);
    } finally { gateway.restore(); }
  });

  it('records the provider usage the gateway reported', async () => {
    const state = sharedPrisma();
    const gateway = stubGateway({
      status: 'ok', contractVersion: 1, pages: [{ pageIndex: 0, text: 'A', truncated: false, blank: false }],
      usage: [{ tag: 'ocr.capture.read', modelId: 'anthropic.claude-sonnet-4-6', ok: true, inputTokens: 1_000, outputTokens: 100, cacheReadInputTokens: 0, cacheWriteInputTokens: 0 }],
    });
    try {
      const client = new ExpenseCaptureReadClient(config, undefined, state.prisma);
      await client.readChunk({ companyId: 'co-1', userId: 'system', requestId: 'r', jobId: 'job-1', fileLabel: 'f', chunk });
      assert.equal(state.usage.length, 1);
      assert.equal(state.usage[0].sourceRoute, CAPTURE_USAGE_SOURCE_ROUTE);
      assert.equal(state.usage[0].budgetBucket, 'OCR');
    } finally { gateway.restore(); }
  });
});
