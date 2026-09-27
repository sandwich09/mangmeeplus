/**
 * The two internal money endpoints the AI Gateway will call in Phase E1c. A new spec file is
 * unavoidable: the controller is new, and `internal-tools.controller.spec.ts` covers the ERP tool
 * route's own authorization chain.
 *
 * Focus: the internal-secret gate, and that nothing that decides money is taken from the request
 * body — the parent reservation supplies the bucket, the month, the route, the model and the FX.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { UnauthorizedException } from '@nestjs/common';
import { AI_BUDGET_STEP_BOUNDS } from '@watchdog-bms/contracts';
import { InternalAiBudgetController } from './internal-ai-budget.controller';

const HAIKU = 'apac.anthropic.claude-3-haiku-20240307-v1:0';
const config = { aiGatewayInternalSecret: 'workload-secret', aiMonthlyBudgetSatang: 1_000_000 } as never;

/** Just enough of the ledger for reserve + dispatch; the engine's own behaviour is proven elsewhere. */
function prismaWithParent(parent: Record<string, unknown> | null) {
  const created: any[] = [];
  const tx = {
    $executeRaw: async () => 0,
    companyAiConfiguration: async () => null,
    platformAiBudgetConfig: { findUnique: async () => null },
    aiBudgetReservation: {
      findFirst: async () => parent,
      // The controller looks the ordinal-0 parent up by its unique invocation key; the engine's own
      // duplicate check looks up the CHILD key, which does not exist yet.
      findUnique: async (args: any) => (String(args?.where?.invocationKey ?? '').endsWith('#0') ? parent : null),
      groupBy: async () => [],
      count: async () => 0,
      create: async (args: any) => { created.push(args.data); return { id: 'res-new' }; },
      updateMany: async () => ({ count: 1 }),
    },
    companyAiMonthlyUsage: { findUnique: async () => ({ costSatang: 0 }) },
    companyAiMonthlyBucketUsage: { findUnique: async () => ({ costSatang: 0 }) },
  } as any;
  tx.companyAiConfiguration = {
    findUnique: async () => ({
      monthlyBudgetSatang: 1_000_000, budgetMode: 'SPLIT',
      chatMonthlyBudgetSatang: 500_000, ocrMonthlyBudgetSatang: 500_000,
      budgetConfigVersion: 1, pendingBudgetPolicy: null,
    }),
  };
  const client = { ...tx, $transaction: async (fn: (t: any) => Promise<any>) => fn(tx) };
  return { prisma: { client } as never, created };
}

const parentRow = {
  bucket: 'OCR', sourceRoute: 'receipt-ocr', requestKind: 'IMAGE', status: 'DISPATCHED',
  pricingSnapshot: { modelId: HAIKU, thbPerUsd: 33, thbPerUsdSource: 'stored' },
};

const stepBody = (over: Record<string, unknown> = {}) => ({
  companyId: 'co-1', attemptKey: 'line-image:ab12', stepKind: 'receipt-ocr',
  ordinal: 1, monthKey: '2026-09', ...over,
}) as never;

describe('InternalAiBudgetController auth', () => {
  it('refuses every route without the internal secret', async () => {
    const controller = new InternalAiBudgetController(config, prismaWithParent(parentRow).prisma);

    await assert.rejects(() => controller.budgetStep(undefined, stepBody()), UnauthorizedException);
    await assert.rejects(() => controller.budgetStep('wrong-secret', stepBody()), UnauthorizedException);
    await assert.rejects(
      () => controller.budgetSettle('wrong-secret', { invocationKey: 'k', sourceRoute: 'r', usage: {} } as never),
      UnauthorizedException,
    );
  });
});

describe('POST /internal/ai/budget-step', () => {
  it('accepts transformed v2 DTO fields while rejecting supplied legacy values', async () => {
    const calls: unknown[] = [];
    const authority = { reserve: async (...args: unknown[]) => { calls.push(args); return { ok: true, envelope: { version: 2 } }; } };
    const controller = new InternalAiBudgetController(config, prismaWithParent(null).prisma, authority as never);
    const body = { version: 2, invocation: { ordinal: 0 }, repair: false,
      companyId: undefined, attemptKey: undefined, stepKind: undefined, ordinal: undefined, monthKey: undefined };
    assert.deepEqual(await controller.budgetStep('workload-secret', body as never), { ok: true, envelope: { version: 2 } });
    for (const value of ['foreign-company', null, 0]) {
      assert.deepEqual(await controller.budgetStep('workload-secret', { ...body, companyId: value } as never),
        { ok: false, code: 'AI_BUDGET_UNAVAILABLE', budgetScope: 'TOTAL' });
    }
    assert.equal(calls.length, 1);
  });

  it('reserves the next invocation using the PARENT\'s bucket, route, model and FX — not the body', async () => {
    const { prisma, created } = prismaWithParent(parentRow);
    const controller = new InternalAiBudgetController(config, prisma);

    const result = await controller.budgetStep('workload-secret', stepBody());

    assert.equal((result as { ok: boolean }).ok, true);
    assert.equal(created.length, 1);
    assert.equal(created[0].bucket, 'OCR', 'the bucket comes from the parent hold');
    assert.equal(created[0].sourceRoute, 'receipt-ocr');
    assert.equal(created[0].monthKey, '2026-09');
    assert.equal(created[0].pricingSnapshot.modelId, HAIKU);
    assert.equal(created[0].pricingSnapshot.thbPerUsd, 33, 'priced at the PINNED FX, not a fresh rate');
    assert.equal(created[0].invocationKey, 'co-1#line-image:ab12#receipt-ocr#1');
    // Inherited, so a gateway-driven settlement is not UNKNOWN in the D1 breakdown.
    assert.equal(created[0].requestKind, 'IMAGE');
    const envelope = (result as { envelope: { bounds: unknown; maxCalls: number } }).envelope;
    assert.deepEqual(envelope.bounds, AI_BUDGET_STEP_BOUNDS['receipt-ocr']);
    assert.equal(envelope.maxCalls, AI_BUDGET_STEP_BOUNDS['receipt-ocr'].maxCalls);
  });

  it('refuses when no parent hold exists for that company/month/attempt/step', async () => {
    const controller = new InternalAiBudgetController(config, prismaWithParent(null).prisma);

    assert.deepEqual(await controller.budgetStep('workload-secret', stepBody()),
      { ok: false, code: 'AI_BUDGET_UNAVAILABLE', budgetScope: 'TOTAL' });
  });

  it('refuses an ordinal at or past the step kind\'s declared call ceiling', async () => {
    const controller = new InternalAiBudgetController(config, prismaWithParent(parentRow).prisma);
    const maxCalls = AI_BUDGET_STEP_BOUNDS['receipt-ocr'].maxCalls;

    assert.deepEqual(await controller.budgetStep('workload-secret', stepBody({ ordinal: maxCalls })),
      { ok: false, code: 'AI_BUDGET_UNAVAILABLE', budgetScope: 'TOTAL' });
  });

  it('refuses to continue a chain whose ordinal-0 call was PROVEN never to start', async () => {
    const controller = new InternalAiBudgetController(config, prismaWithParent({ ...parentRow, status: 'CANCELLED' }).prisma);

    assert.deepEqual(await controller.budgetStep('workload-secret', stepBody()),
      { ok: false, code: 'AI_BUDGET_UNAVAILABLE', budgetScope: 'TOTAL' });
  });

  it('refuses an undeclared step kind and a malformed month key', async () => {
    const controller = new InternalAiBudgetController(config, prismaWithParent(parentRow).prisma);

    for (const body of [stepBody({ stepKind: 'line-telepathy' }), stepBody({ monthKey: '2026-13' })]) {
      assert.deepEqual(await controller.budgetStep('workload-secret', body),
        { ok: false, code: 'AI_BUDGET_UNAVAILABLE', budgetScope: 'TOTAL' });
    }
  });
});

describe('POST /internal/ai/budget-settle', () => {
  it('rejects malformed evidence without settling anything', async () => {
    const controller = new InternalAiBudgetController(config, prismaWithParent(parentRow).prisma);

    const result = await controller.budgetSettle('workload-secret', {
      invocationKey: 'co-1#line-image:ab12#receipt-ocr#0', sourceRoute: 'receipt-ocr',
      usage: { modelId: HAIKU, tag: 'ocr.receipt.image-read', ok: true, inputTokens: -1,
        outputTokens: 0, cacheReadInputTokens: 0, cacheWriteInputTokens: 0 },
    } as never);

    assert.deepEqual(result, { result: 'invalid-evidence' });
  });
});

describe('versioned budget-step authority transport', () => {
  it('authenticates before v2 reservation and sends only the invocation and explicit repair flag to the issuer', async () => {
    let calls = 0; let received: unknown[] = [];
    const authority = { reserve: async (...args: unknown[]) => { calls++; received = args; return { ok: true, envelope: { version: 2 } }; } } as never;
    const controller = new InternalAiBudgetController(config, prismaWithParent(null).prisma, authority);
    const body = { version: 2, invocation: { grant: { signature: 'synthetic' } }, repair: true } as never;
    await assert.rejects(controller.budgetStep('wrong-secret', body), UnauthorizedException);
    assert.equal(calls, 0);
    assert.deepEqual(await controller.budgetStep('workload-secret', body), { ok: true, envelope: { version: 2 } });
    assert.deepEqual(received, [(body as any).invocation, true]);
    assert.equal(calls, 1);
  });
  it('rejects v2/v1 shape confusion and unavailable issuer rather than downgrading to a legacy hold', async () => {
    let calls = 0;
    const authority = { reserve: async () => { calls++; return { ok: true }; } } as never;
    const controller = new InternalAiBudgetController(config, prismaWithParent(parentRow).prisma, authority);
    for (const body of [{ version: 2, invocation: {}, companyId: 'forged' }, { invocation: {}, ...(stepBody() as Record<string, unknown>) }, { version: 3, ...(stepBody() as Record<string, unknown>) }]) {
      assert.deepEqual(await controller.budgetStep('workload-secret', body as never), { ok: false, code: 'AI_BUDGET_UNAVAILABLE', budgetScope: 'TOTAL' });
    }
    assert.equal(calls, 0);
    const absent = new InternalAiBudgetController(config, prismaWithParent(null).prisma);
    assert.deepEqual(await absent.budgetStep('workload-secret', { version: 2, invocation: {} } as never), { ok: false, code: 'AI_BUDGET_UNAVAILABLE', budgetScope: 'TOTAL' });
  });
});
