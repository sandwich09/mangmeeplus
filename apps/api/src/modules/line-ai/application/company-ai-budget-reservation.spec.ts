/**
 * Unit half of the SPLIT reservation engine. A new file is unavoidable: the engine is a new module
 * and its neighbours' specs (`company-ai-usage-meter.spec.ts`, `ai-model-pricing.spec.ts`) cover
 * the admission vocabulary and the bound pricing respectively.
 *
 * Everything that needs real transaction/lock semantics — concurrent reserve, concurrent settle,
 * the sweep under contention, a cap change racing a reserve — is in
 * `company-ai-budget-reservation.pg.spec.ts` against real PostgreSQL, because a fake cannot prove
 * serialization.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AI_BUDGET_STEP_BOUNDS, aiBudgetInvocationKey, type AiUsageEntry } from '@watchdog-bms/contracts';
import {
  AI_BUDGET_DISPATCHED_SWEEP_MS,
  AI_BUDGET_RESERVED_SWEEP_MS,
  acknowledgeAiBudgetBreach,
  aiBudgetAttemptHash,
  cancelAiBudgetStep,
  chargeAiBudgetHoldAtBound,
  listAiBudgetCreditHolds,
  releaseAiBudgetHoldByOperator,
  shortenInvocationKey,
  cancelAiBudgetStepIfGatewayUnspent,
  decideAiBudgetStep,
  gatewayRefusedWithoutSpending,
  markAiBudgetStepDispatched,
  reserveAiBudgetStep,
  settleAiBudgetStep,
} from './company-ai-budget-reservation';
import { splitPrisma } from './company-ai-budget-prisma.fixture';
import { priceRenderedAiInvocationV2 } from './ai-model-pricing';
import { aiCreditLotOrder, consumeAiCreditHold, planAiCreditAllocation, type AiCreditLot } from './ai-credit-ledger';
import { aiCreditCycleAllowance } from './company-ai-budget-policy';

const decide = (over: Partial<Parameters<typeof decideAiBudgetStep>[0]> = {}) => decideAiBudgetStep({
  bucket: 'CHAT', boundSatang: 100, totalSatang: 10_000, capSatang: 3_000,
  spent: { total: 0, bucket: 0 }, reserved: { total: 0, bucket: 0 }, override: false, ...over,
});

describe('decideAiBudgetStep (ADR 0013 §5 decision table)', () => {
  it('admits inside both ceilings', () => {
    assert.deepEqual(decide(), { ok: true });
  });

  it('checks the TOTAL before the bucket — the total is the ceiling neither bucket may cross', () => {
    // The bucket is wide open; only the total is exhausted. The scope reported must be TOTAL.
    const decision = decide({ spent: { total: 10_000, bucket: 0 } });

    assert.equal(decision.ok, false);
    assert.equal((decision as { reason: string }).reason, 'exceeded');
    assert.equal((decision as { budgetScope: string }).budgetScope, 'TOTAL');
  });

  it('separates exceeded (the cap is REACHED) from insufficient (money left, not enough)', () => {
    const exceeded = decide({ spent: { total: 3_000, bucket: 3_000 } });
    const insufficient = decide({ spent: { total: 2_950, bucket: 2_950 } });

    assert.equal((exceeded as { reason: string }).reason, 'exceeded');
    assert.equal((insufficient as { reason: string }).reason, 'insufficient');
    // Near-limit must never be reported as "full" (spec §12.3, E-06).
    assert.equal((insufficient as { budgetScope: string }).budgetScope, 'CHAT');
    assert.equal((insufficient as { reservedSatang: number }).reservedSatang, 0);
  });

  it('counts live holds, not only spend: a funded bucket with holds can still be insufficient', () => {
    const decision = decide({ spent: { total: 0, bucket: 0 }, reserved: { total: 2_950, bucket: 2_950 } });

    assert.equal((decision as { reason: string }).reason, 'insufficient');
    assert.equal((decision as { spendSatang: number }).spendSatang, 0, 'spend is 0 and must be reported as 0');
  });

  it('a cap of 0 closes that bucket at zero spend — "this bucket is not allowed" (spec §12.1)', () => {
    const decision = decide({ capSatang: 0 });

    assert.equal((decision as { reason: string }).reason, 'exceeded');
    assert.equal((decision as { budgetScope: string }).budgetScope, 'CHAT');
  });

  it('CHAT full leaves OCR open, and the reverse — no borrowing either way (E-02)', () => {
    // T=10000, C=3000, O=7000. CHAT has spent its 3000; OCR has spent nothing.
    const chat = decide({ bucket: 'CHAT', capSatang: 3_000, spent: { total: 3_000, bucket: 3_000 } });
    const ocr = decide({ bucket: 'OCR', capSatang: 7_000, spent: { total: 3_000, bucket: 0 } });

    assert.equal((chat as { reason: string }).reason, 'exceeded');
    assert.deepEqual(ocr, { ok: true });

    // ...and the mirror: OCR exhausted must not close a funded CHAT.
    const ocrFull = decide({ bucket: 'OCR', capSatang: 7_000, spent: { total: 7_000, bucket: 7_000 } });
    const chatOpen = decide({ bucket: 'CHAT', capSatang: 3_000, spent: { total: 7_000, bucket: 0 } });

    assert.equal((ocrFull as { reason: string }).reason, 'exceeded');
    assert.deepEqual(chatOpen, { ok: true });
  });

  it('TOTAL full stops BOTH buckets even while each bucket cap still has room', () => {
    for (const bucket of ['CHAT', 'OCR'] as const) {
      const decision = decide({ bucket, capSatang: 7_000, spent: { total: 10_000, bucket: 1_000 } });
      assert.equal((decision as { budgetScope: string }).budgetScope, 'TOTAL', bucket);
    }
  });

  it('admits exactly up to the boundary and refuses one satang past it', () => {
    assert.deepEqual(decide({ spent: { total: 0, bucket: 2_900 }, boundSatang: 100 }), { ok: true });
    assert.equal((decide({ spent: { total: 0, bucket: 2_901 }, boundSatang: 100 }) as { reason: string }).reason, 'insufficient');
  });
});

describe('reserveAiBudgetStep pre-transaction guards (readiness, ADR 0013 §9)', () => {
  /** `null as never` proves these refuse BEFORE any database work: a DB call would throw. */
  const noDb = null as never;
  const base = {
    companyId: 'c1', monthKey: '2026-09', bucket: 'CHAT' as const, attemptKey: 'line-text:abc',
    ordinal: 0, sourceRoute: 'line-turn', modelId: 'apac.anthropic.claude-3-haiku-20240307-v1:0',
    thbPerUsd: 33, thbPerUsdSource: 'stored',
  };

  it('a step kind nobody declared a bound for can never be reserved', async () => {
    const outcome = await reserveAiBudgetStep(noDb, noDb, { ...base, stepKind: 'line-telepathy' });

    assert.deepEqual(outcome, { ok: false, reason: 'unavailable', budgetScope: 'TOTAL', detail: 'step_bound_missing' });
  });

  it('refuses an ordinal at or past the step kind\'s declared call ceiling', async () => {
    const maxCalls = AI_BUDGET_STEP_BOUNDS['receipt-ocr'].maxCalls;
    const outcome = await reserveAiBudgetStep(noDb, noDb, { ...base, stepKind: 'receipt-ocr', ordinal: maxCalls });

    assert.equal((outcome as { detail: string }).detail, 'step_call_budget_exhausted');
    assert.equal((outcome as { reason: string }).reason, 'unavailable');
  });

  it('refuses an unknown bucket and an unpinnable model — never an unmetered pass (F-07)', async () => {
    assert.equal(((await reserveAiBudgetStep(noDb, noDb, { ...base, stepKind: 'line-turn', bucket: 'MISC' as never })) as { detail: string }).detail, 'bucket_unknown');
    assert.equal(((await reserveAiBudgetStep(noDb, noDb, { ...base, stepKind: 'line-turn', modelId: '' })) as { detail: string }).detail, 'model_unknown');
    assert.equal(((await reserveAiBudgetStep(noDb, noDb, { ...base, stepKind: 'line-turn', thbPerUsd: Number.NaN })) as { detail: string }).detail, 'price_unavailable');
  });
});

describe('lock scope: the platform lock is taken only when the company INHERITS the default', () => {
  /** Captures the advisory-lock keys `reserveAiBudgetStep` takes, in order. */
  function lockCapturingPrisma(monthlyBudgetSatang: number | null) {
    const lockOrder: string[] = [];
    const tx = {
      $executeRaw: async (_sql: TemplateStringsArray, key: string) => { lockOrder.push(key); return 0; },
      companyAiConfiguration: {
        findUnique: async () => ({
          monthlyBudgetSatang, budgetMode: 'SPLIT',
          chatMonthlyBudgetSatang: 500_000, ocrMonthlyBudgetSatang: 500_000,
          budgetConfigVersion: 1, pendingBudgetPolicy: null,
        }),
      },
      platformAiBudgetConfig: { findUnique: async () => ({ monthlyBudgetSatang: 1_000_000 }) },
      aiBudgetReservation: {
        findUnique: async () => null, groupBy: async () => [], count: async () => 0,
        updateMany: async () => ({ count: 0 }),
        create: async () => ({ id: 'res-1' }),
      },
      companyAiMonthlyUsage: { findUnique: async () => ({ costSatang: 0 }) },
      companyAiMonthlyBucketUsage: { findUnique: async () => ({ costSatang: 0 }) },
    } as any;
    return {
      prisma: { client: { $transaction: async (fn: (t: any) => Promise<unknown>) => fn(tx) } } as never,
      lockOrder,
    };
  }
  const config = { aiMonthlyBudgetSatang: 1_000_000 } as never;
  const input = {
    companyId: 'co-1', monthKey: '2026-09', bucket: 'CHAT' as const, stepKind: 'crm-intake',
    attemptKey: 'crm:crm-intake:req-1', ordinal: 0, sourceRoute: 'crm-intake',
    modelId: 'apac.anthropic.claude-3-haiku-20240307-v1:0', thbPerUsd: 33, thbPerUsdSource: 'stored',
  };

  it('skips the PLATFORM-WIDE lock for a company with its own override', async () => {
    const { prisma, lockOrder } = lockCapturingPrisma(1_000_000);

    const outcome = await reserveAiBudgetStep(prisma, config, input);

    assert.equal(outcome.ok, true);
    // Two company-scoped locks only: one tenant's reservations must not serialise every other
    // tenant's behind a single platform-wide lock.
    assert.deepEqual(lockOrder, ['partner-ocr-config:co-1', 'ai-budget:co-1:2026-09']);
  });

  it('takes it, in canonical order, when the company inherits the platform default', async () => {
    const { prisma, lockOrder } = lockCapturingPrisma(null);

    const outcome = await reserveAiBudgetStep(prisma, config, input);

    assert.equal(outcome.ok, true);
    // config -> platform -> ai-budget: the same order the admin writers use, so no deadlock.
    assert.deepEqual(lockOrder, ['partner-ocr-config:co-1', 'platform-ai-budget', 'ai-budget:co-1:2026-09']);
  });
});

describe('execution identities (ADR 0013 §4, R-03)', () => {
  it('an invocation key is company + attempt + step kind + bounded call ordinal', () => {
    assert.equal(aiBudgetInvocationKey('co-1', 'line-image:ab12', 'receipt-ocr', 2), 'co-1#line-image:ab12#receipt-ocr#2');
  });

  it('hashes a LINE id: an execution identity carries no raw LINE id (spec §12.4)', () => {
    const raw = 'U4af4980629...';
    const hashed = aiBudgetAttemptHash(raw);

    assert.equal(hashed.length, 32);
    assert.match(hashed, /^[0-9a-f]{32}$/);
    assert.ok(!hashed.includes(raw.slice(0, 6)), 'the raw id must not survive into the key');
    assert.equal(hashed, aiBudgetAttemptHash(raw), 'stable, so a transport retry is the same attempt');
    assert.notEqual(hashed, aiBudgetAttemptHash(`${raw}x`));
  });

  it('a drain reclaim is the SAME attempt at the next retry ordinal, never a fresh identity', () => {
    // What `AiGatewayClient.requestLineTurn` builds for delivery 0 (live) and delivery 2 (reclaim).
    const webhookEventId = 'evt-0001';
    const live = `line-text:${aiBudgetAttemptHash(webhookEventId)}`;
    const reclaim = `line-text:${aiBudgetAttemptHash(webhookEventId)}:r2`;

    assert.ok(reclaim.startsWith(live), 'the reclaim keeps the original webhook event as its base');
    assert.notEqual(aiBudgetInvocationKey('co-1', live, 'line-turn', 0), aiBudgetInvocationKey('co-1', reclaim, 'line-turn', 0));
  });

  it('is company-scoped, so one tenant cannot claim the fence another tenant needs', () => {
    assert.notEqual(
      aiBudgetInvocationKey('co-a', 'line-text:ab12', 'line-turn', 0),
      aiBudgetInvocationKey('co-b', 'line-text:ab12', 'line-turn', 0),
    );
  });
});

describe('sweep thresholds (ADR 0013 §6)', () => {
  it('the RESERVED window is far longer than the reserve→dispatch gap and shorter than the dispatched one', () => {
    assert.ok(AI_BUDGET_RESERVED_SWEEP_MS >= 10 * 60 * 1_000);
    assert.ok(AI_BUDGET_DISPATCHED_SWEEP_MS > AI_BUDGET_RESERVED_SWEEP_MS);
  });

  it('the DISPATCHED window strictly outlasts the longest caller timeout (receipt OCR at 195s)', () => {
    // 4 × 45s + 15s = 195_000 ms, plus the 180s admission lease. A slow-but-alive call must never
    // be relabelled UNRESOLVED, and UNRESOLVED still counts as reserved either way.
    assert.ok(AI_BUDGET_DISPATCHED_SWEEP_MS > 195_000 + 180_000);
  });
});

describe('the fixed aggregate row order (deadlock avoidance)', () => {
  it('is documented identically in all three writers of the two aggregates', () => {
    // A contract between three files that Postgres enforces only by killing one of them, so it is
    // asserted here rather than left to a comment nobody re-reads.
    const read = (path: string) => readFileSync(join(__dirname, path), 'utf8');
    for (const [label, source] of [
      ['reservation engine', read('company-ai-budget-reservation.ts')],
      ['meter', read('company-ai-usage-meter.ts')],
    ] as const) {
      assert.match(source, /Row order is FIXED across every writer/, label);
    }
    // And the meter really does upsert the month row before the bucket row.
    const meter = read('company-ai-usage-meter.ts');
    assert.ok(
      meter.indexOf('const aggregate = await tx.companyAiMonthlyUsage.upsert') < meter.indexOf('await upsertBucketUsage(tx, meta.companyId'),
      'recordCompanyAiUsage must write the MONTH row before the bucket row',
    );
    const engine = read('company-ai-budget-reservation.ts');
    assert.ok(
      engine.indexOf('await tx.companyAiMonthlyUsage.upsert') < engine.indexOf('await upsertBucketUsage(tx, reservation.companyId'),
      'settleAiBudgetStep must write the MONTH row before the bucket row',
    );
  });
});

describe('settleAiBudgetStep evidence guard (D1 guard, spec §12.3)', () => {
  /** Again `null as never`: malformed evidence must be rejected before any database work. */
  const noDb = null as never;
  const good = {
    modelId: 'apac.anthropic.claude-3-haiku-20240307-v1:0', tag: 'line.loop', ok: true,
    inputTokens: 10, outputTokens: 5, cacheReadInputTokens: 0, cacheWriteInputTokens: 0,
  };

  for (const [label, entry] of [
    ['a negative counter', { ...good, inputTokens: -1 }],
    ['a non-integer counter', { ...good, outputTokens: 1.5 }],
    ['NaN', { ...good, cacheReadInputTokens: Number.NaN }],
    ['a missing model id', { ...good, modelId: '' }],
    ['a missing tag', { ...good, tag: '' }],
    ['a non-boolean ok', { ...good, ok: 'yes' }],
  ] as const) {
    it(`settles nothing and leaves the hold for ${label}`, async () => {
      const result = await settleAiBudgetStep(noDb, {
        invocationKey: 'line-text:ab#line-turn#0', entry: entry as never, meta: { sourceRoute: 'line-turn' },
      });

      assert.equal(result, 'invalid-evidence');
    });
  }
});

// ── Fenced state transitions (the CAS shapes, without transaction semantics) ──

type Recorded = { where: Record<string, unknown>; data: Record<string, unknown> };

function fakePrisma(options: { count: number; row?: { companyId: string; monthKey: string } | null }) {
  const updates: Recorded[] = [];
  const client = {
    aiBudgetReservation: {
      updateMany: async (args: Recorded) => { updates.push(args); return { count: options.count }; },
      findUnique: async () => (options.row === undefined ? { companyId: 'c1', monthKey: '2026-09' } : options.row),
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({
      $executeRaw: async () => 0,
      aiBudgetReservation: { updateMany: async (args: Recorded) => { updates.push(args); return { count: options.count }; } },
    }),
  };
  return { prisma: { client } as never, updates };
}

describe('markAiBudgetStepDispatched', () => {
  it('is a fenced CAS from RESERVED only, so a stale owner cannot mark a new hold dispatched', async () => {
    const { prisma, updates } = fakePrisma({ count: 1 });

    assert.equal(await markAiBudgetStepDispatched(prisma, 'res-1', 'owner-1'), true);
    assert.deepEqual(updates[0]!.where, { id: 'res-1', ownerToken: 'owner-1', status: 'RESERVED' });
    assert.equal(updates[0]!.data['status'], 'DISPATCHED');
  });

  it('reports failure when the CAS matched nothing (already dispatched, or another owner)', async () => {
    const { prisma } = fakePrisma({ count: 0 });

    assert.equal(await markAiBudgetStepDispatched(prisma, 'res-1', 'owner-1'), false);
  });
});

describe('cancelAiBudgetStep (R-04 fencing, R-05 no money back without proof)', () => {
  it('releases a DISPATCHED hold ONLY with an explicit no-provider proof', async () => {
    const { prisma, updates } = fakePrisma({ count: 1 });

    assert.equal(await cancelAiBudgetStep(prisma, { reservationId: 'r', ownerToken: 'o', proof: 'gateway_pre_provider_refusal' }), true);
    assert.deepEqual(updates[0]!.where['status'], { in: ['RESERVED', 'DISPATCHED'] });
    assert.equal(updates[0]!.data['status'], 'CANCELLED');
    assert.equal((updates[0]!.data['evidenceJson'] as { proof: string }).proof, 'gateway_pre_provider_refusal');
  });

  it('the sweep proof may only touch RESERVED — a dispatched hold is never swept free', async () => {
    const { prisma, updates } = fakePrisma({ count: 1 });

    await cancelAiBudgetStep(prisma, { reservationId: 'r', ownerToken: 'o', proof: 'never_dispatched' });

    assert.equal(updates[0]!.where['status'], 'RESERVED');
  });

  it('is fenced on the owner token, so a stale compensation is a no-op', async () => {
    const { prisma, updates } = fakePrisma({ count: 0 });

    assert.equal(await cancelAiBudgetStep(prisma, { reservationId: 'r', ownerToken: 'stale', proof: 'ocr_admission_refused' }), false);
    assert.equal(updates[0]!.where['ownerToken'], 'stale');
  });

  it('does nothing at all when the reservation is gone', async () => {
    const { prisma, updates } = fakePrisma({ count: 1, row: null });

    assert.equal(await cancelAiBudgetStep(prisma, { reservationId: 'gone', ownerToken: 'o', proof: 'never_dispatched' }), false);
    assert.equal(updates.length, 0);
  });
});

/**
 * Phase E1c: releasing a hold the GATEWAY provably never spent. Without this, one misdeclared
 * bound would pile up permanent `DISPATCHED -> UNRESOLVED` holds and close a bucket with nothing
 * spent. The proof is OUR refusal code plus zero usage rows.
 */
describe('gatewayRefusedWithoutSpending (E1c no-spend proof)', () => {
  const row = (over: Partial<AiUsageEntry> = {}): AiUsageEntry => ({
    tag: 'ocr.receipt.image-read', modelId: 'haiku', ok: true, inputTokens: 10, outputTokens: 2,
    cacheReadInputTokens: 0, cacheWriteInputTokens: 0, durationMs: 1, ...over,
  });

  it('is true only for OUR codes with no usage at all', () => {
    for (const code of ['AI_BUDGET_UNAVAILABLE', 'AI_BUDGET_INSUFFICIENT', 'AI_MONTHLY_BUDGET_EXCEEDED', 'AI_BUDGET_BUSY']) {
      assert.equal(gatewayRefusedWithoutSpending(code, undefined), true, code);
      assert.equal(gatewayRefusedWithoutSpending(code, []), true, code);
    }
  });

  it('is false for every failure that is not a money answer', () => {
    // A provider outage, a truncated read, a bad mime type: the hold's fate is decided elsewhere,
    // and guessing "no spend" from any of these would release money a provider may have cost.
    for (const code of ['PROVIDER_TIMEOUT', 'OCR_OUTPUT_TRUNCATED', 'UNSUPPORTED_MIME_TYPE',
      'OCR_MONTHLY_LIMIT_EXCEEDED', 'ROUTER_UNREACHABLE', 'PROVIDER_BUDGET_EXHAUSTED', '', null, undefined]) {
      assert.equal(gatewayRefusedWithoutSpending(code, []), false, String(code));
    }
  });

  it('is false whenever ANY usage row came back — a mid-chain refusal keeps paying', () => {
    // The receipt read ran at ordinal 0 and the extract could not be funded: the response carries
    // `AI_BUDGET_INSUFFICIENT` AND the read's row. Releasing the hold would un-bill a real call.
    assert.equal(gatewayRefusedWithoutSpending('AI_BUDGET_INSUFFICIENT',
      [row({ invocationKey: 'co-1#a#receipt-ocr#0' })]), false);
    // An UNTAGGED row counts too: the response path settles the first one against this invocation.
    assert.equal(gatewayRefusedWithoutSpending('AI_BUDGET_INSUFFICIENT', [row()]), false);
  });
});

describe('cancelAiBudgetStepIfGatewayUnspent (E1c, one helper for every seam shape)', () => {
  const hold = {
    id: 'res-1', companyId: 'co-1', monthKey: '2026-09', bucket: 'OCR' as const, stepKind: 'receipt-ocr',
    attemptKey: 'line-image:abc', invocationKey: 'co-1#line-image:abc#receipt-ocr#0', ordinal: 0,
    upperBoundSatang: 777, ownerToken: 'owner-1',
    envelope: {
      attemptKey: 'line-image:abc', stepKind: 'receipt-ocr' as const,
      invocationKey: 'co-1#line-image:abc#receipt-ocr#0', bucket: 'OCR' as const, monthKey: '2026-09',
      modelId: 'haiku', bounds: { ...AI_BUDGET_STEP_BOUNDS['receipt-ocr'] },
      maxCalls: AI_BUDGET_STEP_BOUNDS['receipt-ocr'].maxCalls,
    },
  };

  /** The exact field each seam reads its budget code from (all five, one table). */
  const seamShapes: Array<[string, { budgetCode?: string | null; usage?: AiUsageEntry[] }]> = [
    // receipt-ocr / bank-statement: `{status:'failed', errorCode}`
    ['{status:failed, errorCode}', { budgetCode: 'AI_BUDGET_UNAVAILABLE' }],
    // line-turn: the turn response's own errorCode
    ['turn response errorCode', { budgetCode: 'AI_BUDGET_UNAVAILABLE', usage: [] }],
    // line-intake-route: the UNAVAILABLE route plan's errorCode
    ['intake plan errorCode', { budgetCode: 'AI_BUDGET_INSUFFICIENT' }],
    // CRM: the whole ProviderError crosses, so the code is on `error.budgetCode`
    ['CRM error.budgetCode', { budgetCode: 'AI_MONTHLY_BUDGET_EXCEEDED' }],
    // draft-generate: `{ok:false, error:{code}}`
    ['draft error.code', { budgetCode: 'AI_BUDGET_UNAVAILABLE' }],
  ];

  it('releases the hold with the pre-provider proof, for every seam shape', async () => {
    for (const [label, answer] of seamShapes) {
      const { prisma, updates } = fakePrisma({ count: 1 });

      assert.equal(await cancelAiBudgetStepIfGatewayUnspent(prisma, hold, answer), true, label);
      assert.deepEqual(updates[0]!.where['status'], { in: ['RESERVED', 'DISPATCHED'] }, label);
      assert.equal(updates[0]!.where['ownerToken'], 'owner-1', label);
      assert.equal((updates[0]!.data['evidenceJson'] as { proof: string }).proof, 'gateway_pre_provider_refusal', label);
    }
  });

  it('touches nothing when there is no hold, or when the answer is not a no-spend refusal', async () => {
    const noHold = fakePrisma({ count: 1 });
    assert.equal(await cancelAiBudgetStepIfGatewayUnspent(noHold.prisma, undefined, { budgetCode: 'AI_BUDGET_UNAVAILABLE' }), false);
    assert.deepEqual(noHold.updates, []);

    const spent = fakePrisma({ count: 1 });
    assert.equal(await cancelAiBudgetStepIfGatewayUnspent(spent.prisma, hold, {
      budgetCode: 'AI_BUDGET_INSUFFICIENT',
      usage: [{ tag: 'ocr.receipt.image-read', modelId: 'haiku', ok: true, inputTokens: 1, outputTokens: 1,
        cacheReadInputTokens: 0, cacheWriteInputTokens: 0, durationMs: 1 }],
    }), false, 'a refusal at ordinal >= 1 arrives with the PARENT hold and the parent row');
    assert.deepEqual(spent.updates, []);

    const failed = fakePrisma({ count: 1 });
    assert.equal(await cancelAiBudgetStepIfGatewayUnspent(failed.prisma, hold, { budgetCode: 'PROVIDER_TIMEOUT' }), false);
    assert.deepEqual(failed.updates, []);
  });

  it('reports a fenced no-op honestly instead of claiming a release', async () => {
    // A stale owner, or a hold already settled: the CAS matches nothing and the caller learns so.
    const { prisma } = fakePrisma({ count: 0 });
    assert.equal(await cancelAiBudgetStepIfGatewayUnspent(prisma, hold, { budgetCode: 'AI_BUDGET_UNAVAILABLE' }), false);
  });
});

// ── Operator reconciliation of stranded money (hold spec §4.2) ──────────────────────────────────
//
// The CAS shapes, the audit metadata and the refusal vocabulary. Whether the locks actually
// serialize two operators, and whether the aggregates really move once, is
// `company-ai-credit-holds.pg.spec.ts` against real PostgreSQL.

type OperatorRow = {
  companyId: string; monthKey: string; status: string; bucket: string; stepKind: string;
  invocationKey: string; upperBoundSatang: number; breach: boolean; breachAcknowledgedAt: Date | null;
  pricingSnapshot?: unknown;
};

const HOLD: OperatorRow = {
  companyId: 'c1', monthKey: '2026-09', status: 'UNRESOLVED', bucket: 'OCR', stepKind: 'receipt-ocr',
  invocationKey: aiBudgetInvocationKey('c1', 'attempt-1', 'receipt-ocr', 0), upperBoundSatang: 47,
  breach: false, breachAcknowledgedAt: null,
  pricingSnapshot: { modelId: 'apac.anthropic.claude-3-haiku-20240307-v1:0', thbPerUsd: 33, thbPerUsdSource: 'stored' },
};

const DECISION = {
  reservationId: 'res-1', companyId: 'c1', actorUserId: 'admin-1', requestId: 'req-1',
  reason: 'ยืนยันกับผู้ให้บริการแล้วว่าไม่ได้เรียก',
};

/** Records every write, so the fence and the audit row can both be asserted from one call. */
function operatorPrisma(options: { count?: number; row?: OperatorRow | null } = {}) {
  const updates: Recorded[] = [];
  const audits: Array<Record<string, unknown>> = [];
  const row = options.row === undefined ? HOLD : options.row;
  const tx = {
    $executeRaw: async () => 0,
    aiBudgetReservation: {
      updateMany: async (args: Recorded) => { updates.push(args); return { count: options.count ?? 1 }; },
    },
    auditLog: { create: async (args: { data: Record<string, unknown> }) => { audits.push(args.data); return args.data; } },
  };
  const client = {
    aiBudgetReservation: { findUnique: async () => row },
    $transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx),
  };
  return { prisma: { client } as never, updates, audits };
}

const AUDIT = { action: 'ai.credit_hold.released' };

describe('releaseAiBudgetHoldByOperator (hold spec §4.2)', () => {
  it('is fenced on UNRESOLVED and needs no owner token — the stranded hold has no live owner', async () => {
    const { prisma, updates } = operatorPrisma();

    const outcome = await releaseAiBudgetHoldByOperator(prisma, DECISION, AUDIT);

    assert.deepEqual(outcome, { ok: true, status: 'CANCELLED', chargedSatang: 0 });
    assert.deepEqual(updates[0]!.where, { id: 'res-1', companyId: 'c1', status: 'UNRESOLVED' });
    assert.equal('ownerToken' in updates[0]!.where, false, 'the owner fence is deliberately absent here');
    assert.equal(updates[0]!.data['status'], 'CANCELLED');
  });

  it('records the operator proof, the actor and the reason on the row itself', async () => {
    const { prisma, updates } = operatorPrisma();
    await releaseAiBudgetHoldByOperator(prisma, DECISION, AUDIT);
    const evidence = updates[0]!.data['evidenceJson'] as { proof: string; operator: { userId: string; reason: string } };
    assert.equal(evidence.proof, 'operator_released');
    assert.deepEqual(evidence.operator, { userId: 'admin-1', reason: DECISION.reason });
  });

  it('writes the audit row in the SAME transaction, as a `company` target the history reads', async () => {
    const { prisma, audits } = operatorPrisma();
    await releaseAiBudgetHoldByOperator(prisma, DECISION, AUDIT);

    assert.equal(audits.length, 1);
    assert.equal(audits[0]!['action'], 'ai.credit_hold.released');
    assert.equal(audits[0]!['targetType'], 'company');
    assert.equal(audits[0]!['targetId'], 'c1');
    assert.equal(audits[0]!['riskLevel'], 'CRITICAL');
    const metadata = audits[0]!['metadataJson'] as Record<string, unknown>;
    assert.equal(metadata['source'], 'ADMIN_ADJUSTMENT');
    assert.equal(metadata['reason'], DECISION.reason);
    assert.equal(metadata['reservationId'], 'res-1');
    assert.equal(metadata['releasedSatang'], 47);
    // The two before/after pairs `partner-ai-adjustment-history.ts` renders in Thai.
    assert.equal(metadata['fromCreditHoldStatus'], 'UNRESOLVED');
    assert.equal(metadata['toCreditHoldStatus'], 'CANCELLED');
  });

  it('refuses a reservation id that belongs to another tenant, and writes nothing', async () => {
    const { prisma, updates, audits } = operatorPrisma({ row: { ...HOLD, companyId: 'other-co' } });

    assert.deepEqual(await releaseAiBudgetHoldByOperator(prisma, DECISION, AUDIT), { ok: false, reason: 'not-found' });
    assert.deepEqual(updates, []);
    assert.deepEqual(audits, []);
  });

  it('answers already-resolved when the CAS matched nothing, and writes no audit row', async () => {
    const { prisma, audits } = operatorPrisma({ count: 0 });

    assert.deepEqual(await releaseAiBudgetHoldByOperator(prisma, DECISION, AUDIT),
      { ok: false, reason: 'already-resolved' });
    assert.deepEqual(audits, [], 'no money moved, so there is nothing to audit');
  });

  it('answers not-found for a hold that is gone', async () => {
    const { prisma, updates } = operatorPrisma({ row: null });
    assert.deepEqual(await releaseAiBudgetHoldByOperator(prisma, DECISION, AUDIT), { ok: false, reason: 'not-found' });
    assert.deepEqual(updates, []);
  });
});

describe('acknowledgeAiBudgetBreach (hold spec §4.2)', () => {
  const ACK_AUDIT = { action: 'ai.credit_breach.acknowledged' };
  const breached = { ...HOLD, status: 'SETTLED', breach: true, settledCostSatang: 60 } as OperatorRow;

  it('is fenced on an UNACKNOWLEDGED breach and touches no money', async () => {
    const { prisma, updates } = operatorPrisma({ row: breached });

    const outcome = await acknowledgeAiBudgetBreach(prisma, DECISION, ACK_AUDIT);

    assert.deepEqual(outcome, { ok: true, status: 'SETTLED', chargedSatang: 0 });
    assert.deepEqual(updates[0]!.where, { id: 'res-1', companyId: 'c1', breach: true, breachAcknowledgedAt: null });
    assert.deepEqual(Object.keys(updates[0]!.data).sort(), ['breachAcknowledgedAt', 'breachAcknowledgedByUserId']);
    assert.equal(updates[0]!.data['breachAcknowledgedByUserId'], 'admin-1');
  });

  it('keeps the breach FACT — only the acknowledgement is written', async () => {
    const { prisma, updates } = operatorPrisma({ row: breached });
    await acknowledgeAiBudgetBreach(prisma, DECISION, ACK_AUDIT);
    assert.equal('breach' in updates[0]!.data, false, 'the historical flag is never cleared');
    assert.equal('settledCostSatang' in updates[0]!.data, false);
    assert.equal('status' in updates[0]!.data, false);
  });

  it('refuses a row that carries no breach at all', async () => {
    const { prisma, updates } = operatorPrisma({ row: HOLD });
    assert.deepEqual(await acknowledgeAiBudgetBreach(prisma, DECISION, ACK_AUDIT), { ok: false, reason: 'not-found' });
    assert.deepEqual(updates, []);
  });

  it('answers already-acknowledged on a repeat', async () => {
    const { prisma, audits } = operatorPrisma({ row: breached, count: 0 });
    assert.deepEqual(await acknowledgeAiBudgetBreach(prisma, DECISION, ACK_AUDIT),
      { ok: false, reason: 'already-acknowledged' });
    assert.deepEqual(audits, []);
  });

  it('audits the acknowledgement as a breach transition, not a status one', async () => {
    const { prisma, audits } = operatorPrisma({ row: breached });
    await acknowledgeAiBudgetBreach(prisma, DECISION, ACK_AUDIT);
    const metadata = audits[0]!['metadataJson'] as Record<string, unknown>;
    assert.equal(metadata['fromCreditBreachAcknowledged'], false);
    assert.equal(metadata['toCreditBreachAcknowledged'], true);
    assert.equal('chargedSatang' in metadata, false, 'acknowledging moves no money');
  });
});

describe('the UNACKNOWLEDGED breach predicate is alert-only', () => {
  it('only the snapshot and operator list count unacknowledged breaches, never admission', () => {
    // The whole point of the two new columns: `breach` stays true forever, so if either of these
    // two reads still counted it, acknowledging would change nothing at all.
    const engine = readFileSync(join(__dirname, 'company-ai-budget-reservation.ts'), 'utf8');
    assert.match(engine, /const UNACKNOWLEDGED_BREACH = \{ breach: true, breachAcknowledgedAt: null \}/);
    assert.equal((engine.match(/\.\.\.UNACKNOWLEDGED_BREACH/g) ?? []).length, 2,
      'the month snapshot and operator list retain the alert predicate');
    assert.equal(/count\(\{ where: \{ companyId, monthKey, breach: true \} \}\)/.test(engine), false,
      'no read may count an acknowledged breach as closing a scope');
  });
});

describe('chargeAiBudgetHoldAtBound (hold spec §4.2)', () => {
  const CHARGE_AUDIT = { action: 'ai.credit_hold.charged_at_bound' };

  /** Everything `settleAiBudgetStep` touches, so the whole write can be asserted from one call. */
  function settlePrisma(row: OperatorRow | null, over: { event?: unknown } = {}) {
    const writes: Record<string, Array<Record<string, unknown>>> = { event: [], month: [], bucket: [], reservation: [], audit: [] };
    const tx = {
      $executeRaw: async () => 0,
      aiBudgetReservation: {
        findUnique: async () => (row ? { id: 'res-1', ...row, requestKind: 'IMAGE' } : null),
        update: async (args: { data: Record<string, unknown> }) => { writes['reservation']!.push(args.data); return args.data; },
      },
      aiUsageEvent: {
        findUnique: async () => over.event ?? null,
        create: async (args: { data: Record<string, unknown> }) => { writes['event']!.push(args.data); return args.data; },
      },
      companyAiMonthlyUsage: {
        upsert: async (args: Record<string, unknown>) => { writes['month']!.push(args); return args; },
      },
      companyAiMonthlyBucketUsage: {
        upsert: async (args: Record<string, unknown>) => { writes['bucket']!.push(args); return args; },
      },
      auditLog: { create: async (args: { data: Record<string, unknown> }) => { writes['audit']!.push(args.data); return args.data; } },
    };
    const client = {
      aiBudgetReservation: { findUnique: async () => row },
      $transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx),
    };
    return { prisma: { client } as never, writes };
  }

  it('charges the hold OWN bound, with zero tokens and the operator basis', async () => {
    const { prisma, writes } = settlePrisma(HOLD);

    const outcome = await chargeAiBudgetHoldAtBound(prisma, DECISION, CHARGE_AUDIT);

    assert.deepEqual(outcome, { ok: true, status: 'SETTLED', chargedSatang: 47 });
    const event = writes['event']![0]!;
    assert.equal(event['costSatang'], 47, 'the declared bound, not a price computed from zero tokens');
    assert.equal(event['inputTokens'], 0);
    assert.equal(event['outputTokens'], 0);
    assert.equal(event['usageBasis'], 'OPERATOR_CHARGED_AT_BOUND');
    assert.equal(event['invocationKey'], HOLD.invocationKey, 'the same fence a real settlement uses');
    // The model the bound was PRICED for — the honest answer, and `usageBasis` says it was not measured.
    assert.equal(event['modelId'], 'apac.anthropic.claude-3-haiku-20240307-v1:0');
    // D1 metadata is inherited from the hold rather than becoming UNKNOWN.
    assert.equal(event['requestKind'], 'IMAGE');
    assert.equal(event['budgetBucket'], 'OCR');
  });

  it('is money without a model call: COST_ADJUSTMENT and callCount 0 in both aggregates (J-07)', async () => {
    const { prisma, writes } = settlePrisma(HOLD);
    await chargeAiBudgetHoldAtBound(prisma, DECISION, CHARGE_AUDIT);

    assert.equal(writes['event']![0]!['eventKind'], 'COST_ADJUSTMENT');
    const month = writes['month']![0]! as { create: Record<string, unknown>; update: Record<string, unknown> };
    assert.equal(month.create['callCount'], 0);
    assert.deepEqual(month.update['callCount'], { increment: 0 });
    assert.equal(month.create['costSatang'], 47);
    const bucket = writes['bucket']![0]! as { create: Record<string, unknown>; update: Record<string, unknown> };
    assert.equal(bucket.create['callCount'], 0);
    assert.equal(bucket.create['costSatang'], 47);
  });

  it('never opens a breach — the charge lands exactly ON the bound', async () => {
    const { prisma, writes } = settlePrisma(HOLD);
    await chargeAiBudgetHoldAtBound(prisma, DECISION, CHARGE_AUDIT);
    const reservation = writes['reservation']![0]!;
    assert.equal(reservation['breach'], false);
    assert.equal(reservation['status'], 'SETTLED');
    assert.equal(reservation['settledCostSatang'], 47);
    assert.equal(reservation['usageBasis'], 'OPERATOR_CHARGED_AT_BOUND');
    const operator = (reservation['evidenceJson'] as { operator?: Record<string, unknown> }).operator;
    assert.deepEqual(operator, { action: 'charge_at_bound', userId: 'admin-1', reason: DECISION.reason });
  });

  it('audits inside the money transaction, with the charged amount', async () => {
    const { prisma, writes } = settlePrisma(HOLD);
    await chargeAiBudgetHoldAtBound(prisma, DECISION, CHARGE_AUDIT);
    assert.equal(writes['audit']!.length, 1);
    const metadata = writes['audit']![0]!['metadataJson'] as Record<string, unknown>;
    assert.equal(metadata['chargedSatang'], 47);
    assert.equal(metadata['toCreditHoldStatus'], 'SETTLED');
  });

  for (const [label, row] of [
    ['a hold real evidence already settled', { ...HOLD, status: 'SETTLED' }],
    ['a hold another operator released', { ...HOLD, status: 'CANCELLED' }],
    ['a hold still in flight', { ...HOLD, status: 'DISPATCHED' }],
  ] as const) {
    it(`refuses ${label} without writing anything`, async () => {
      const { prisma, writes } = settlePrisma(row as OperatorRow);
      assert.deepEqual(await chargeAiBudgetHoldAtBound(prisma, DECISION, CHARGE_AUDIT),
        { ok: false, reason: 'already-resolved' });
      assert.deepEqual(writes['event'], []);
      assert.deepEqual(writes['month'], []);
      assert.deepEqual(writes['audit'], []);
    });
  }

  it('cannot double-charge: an existing event for this invocation is a refusal, not a second row', async () => {
    const { prisma, writes } = settlePrisma(HOLD, { event: { id: 'evt-1' } });
    assert.deepEqual(await chargeAiBudgetHoldAtBound(prisma, DECISION, CHARGE_AUDIT),
      { ok: false, reason: 'already-resolved' });
    assert.deepEqual(writes['event'], []);
  });

  it('refuses another tenant id and a missing hold', async () => {
    const other = settlePrisma({ ...HOLD, companyId: 'other-co' });
    assert.deepEqual(await chargeAiBudgetHoldAtBound(other.prisma, DECISION, CHARGE_AUDIT), { ok: false, reason: 'not-found' });
    const gone = settlePrisma(null);
    assert.deepEqual(await chargeAiBudgetHoldAtBound(gone.prisma, DECISION, CHARGE_AUDIT), { ok: false, reason: 'not-found' });
  });
});

describe('listAiBudgetCreditHolds and the shortened invocation key', () => {
  it('asks for UNRESOLVED holds OR unacknowledged breaches across the given months, newest first', async () => {
    let asked: Record<string, unknown> = {};
    const prisma = { client: { aiBudgetReservation: { findMany: async (args: Record<string, unknown>) => { asked = args; return []; } } } } as never;

    await listAiBudgetCreditHolds(prisma, 'c1', ['2026-09', '2026-08']);

    const where = asked['where'] as Record<string, unknown>;
    assert.equal(where['companyId'], 'c1');
    assert.deepEqual(where['monthKey'], { in: ['2026-09', '2026-08'] });
    assert.deepEqual(where['OR'], [{ status: 'UNRESOLVED' }, { breach: true, breachAcknowledgedAt: null }]);
    assert.deepEqual(asked['orderBy'], [{ createdAt: 'desc' }, { id: 'desc' }]);
  });

  it('labels a row by what it needs, and never ships a message or the full fence value', async () => {
    const rows = [
      { id: 'r1', status: 'UNRESOLVED', stepKind: 'line-turn', bucket: 'CHAT', sourceRoute: 'line-turn',
        requestKind: 'TEXT', upperBoundSatang: 21, settledCostSatang: null, monthKey: '2026-09',
        createdAt: new Date('2026-09-17T03:00:00.000Z'), dispatchedAt: null,
        invocationKey: aiBudgetInvocationKey('c1', 'a'.repeat(32), 'line-turn', 0), breach: false, breachAcknowledgedAt: null },
      { id: 'r2', status: 'SETTLED', stepKind: 'receipt-ocr', bucket: 'OCR', sourceRoute: 'receipt-ocr-web',
        requestKind: null, upperBoundSatang: 47, settledCostSatang: 60, monthKey: '2026-08',
        createdAt: new Date('2026-08-30T03:00:00.000Z'), dispatchedAt: new Date('2026-08-30T03:00:01.000Z'),
        invocationKey: aiBudgetInvocationKey('c1', 'b'.repeat(32), 'receipt-ocr', 2), breach: true, breachAcknowledgedAt: null },
    ];
    const prisma = { client: { aiBudgetReservation: { findMany: async () => rows } } } as never;

    const listed = await listAiBudgetCreditHolds(prisma, 'c1', ['2026-09', '2026-08']);

    assert.deepEqual(listed.map((hold) => hold.kind), ['UNRESOLVED_HOLD', 'BREACH']);
    assert.equal(listed[1]!.settledCostSatang, 60);
    assert.equal(listed[0]!.invocationKeyShort, 'aaaaaaaa…#line-turn#0');
    assert.equal(listed[1]!.invocationKeyShort, 'bbbbbbbb…#receipt-ocr#2');
    for (const hold of listed) {
      assert.equal(hold.invocationKeyShort.includes('c1#'), false, 'the company segment is dropped');
      assert.ok(hold.invocationKeyShort.length < 40);
    }
  });

  it('shortens a malformed key instead of throwing', () => {
    assert.equal(shortenInvocationKey('nonsense'), 'nonsense');
    assert.equal(shortenInvocationKey('x'.repeat(50)).length, 24);
  });
});

describe('AI credit funding order and use (add-on spec §5.2–§5.3, plan PR C3)', () => {
  const lot = (id: string, sourceKind: string, expires: string, available: number, added = '2026-09-01T00:00:00Z'): AiCreditLot =>
    ({ id, sourceKind, availableAt: new Date(added), expiresAt: new Date(expires), available });

  it('spends package credit, then team-given credit, then purchased credit, earliest expiry first inside a group', () => {
    const lots = [
      lot('paid-late', 'ADD_ON_PAID', '2027-09-01T00:00:00Z', 5000),
      lot('paid-soon', 'ADD_ON_PAID', '2027-03-01T00:00:00Z', 500),
      lot('gift', 'ADD_ON_ADMIN', '2027-12-01T00:00:00Z', 300),
      lot('event', 'SALES_EVENT', '2027-06-01T00:00:00Z', 200),
      lot('cycle', 'INCLUDED_CYCLE', '2026-10-15T00:00:00Z', 125),
    ];
    // Spec example: 1.25 left from the package, a 2.00 call takes 1.25 + 0.75 from added credit.
    assert.deepEqual(planAiCreditAllocation(lots, 200), [{ grantId: 'cycle', units: 125 }, { grantId: 'event', units: 75 }]);
    assert.deepEqual(planAiCreditAllocation(lots, 1200)!.map(part => part.grantId), ['cycle', 'event', 'gift', 'paid-soon', 'paid-late']);
    assert.equal(planAiCreditAllocation(lots, 6126), null, 'never more than the lots hold');
    assert.deepEqual(planAiCreditAllocation([lot('empty', 'INCLUDED_CYCLE', '2026-10-15T00:00:00Z', 0)], 1), null);
  });

  it('breaks ties by the time credit was added, then by id, so the order is stable', () => {
    const a = lot('b-id', 'ADD_ON_PAID', '2027-01-01T00:00:00Z', 1, '2026-01-01T00:00:00Z');
    const b = lot('a-id', 'ADD_ON_PAID', '2027-01-01T00:00:00Z', 1, '2026-02-01T00:00:00Z');
    const c = lot('c-id', 'ADD_ON_PAID', '2027-01-01T00:00:00Z', 1, '2026-02-01T00:00:00Z');
    assert.deepEqual([c, b, a].sort(aiCreditLotOrder).map(item => item.id), ['b-id', 'a-id', 'c-id']);
  });

  it('turns a hold into use on the lots it held, in spend order, never above the hold', async () => {
    const written: Array<Record<string, unknown>> = [];
    const hold = (grantId: string, sourceKind: string, units: number) => ({ grantId, units: -units,
      grant: { id: grantId, sourceKind, availableAt: new Date('2026-09-01T00:00:00Z'), expiresAt: new Date('2027-09-01T00:00:00Z') } });
    const tx = { aiCreditEntry: {
      findMany: async () => [hold('paid', 'ADD_ON_PAID', 75), hold('cycle', 'INCLUDED_CYCLE', 125)],
      createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => { written.push(...data); return { count: data.length }; },
    } };
    await consumeAiCreditHold(tx, { companyId: 'c1', reservationId: 'r1', costSatang: 150 });
    assert.deepEqual(written.map(row => [row['grantId'], row['kind'], row['units'], row['operationKey']]), [
      ['cycle', 'CONSUME', -125, 'consume:r1:cycle'], ['paid', 'CONSUME', -25, 'consume:r1:paid']]);
    written.length = 0;
    await consumeAiCreditHold(tx, { companyId: 'c1', reservationId: 'r1', costSatang: 999 });
    assert.equal(written.reduce((sum, row) => sum + (row['units'] as number), 0), -200, 'an actual above the bound is not charged to the customer');
  });

  it('snapshots the per-cycle allowance from the one resolver, with where it came from (Q5)', () => {
    const at = new Date('2026-10-01T00:00:00Z');
    const base = { totalSatang: 200_000, override: false, monthKey: '2026-10', at };
    assert.deepEqual(aiCreditCycleAllowance({ ...base, row: {} }), { units: 5_000, source: 'DEFAULT' });
    assert.deepEqual(aiCreditCycleAllowance({ ...base, row: { salesDealChatCreditSatang: 20_000, salesDealChatCreditEndsAt: new Date('2026-12-01T00:00:00Z') } }),
      { units: 20_000, source: 'SALES_DEAL' });
    assert.deepEqual(aiCreditCycleAllowance({ ...base, row: { salesDealChatCreditSatang: 20_000, salesDealChatCreditEndsAt: new Date('2026-09-15T00:00:00Z') } }),
      { units: 5_000, source: 'DEFAULT' }, 'a deal that ended before the cycle start gives the default');
    assert.deepEqual(aiCreditCycleAllowance({ ...base, override: true, totalSatang: 50_000, row: { monthlyBudgetSatang: 50_000, chatMonthlyBudgetSatang: 50_000 } }),
      { units: 50_000, source: 'ADMIN_CHAT_CREDIT' });
    assert.deepEqual(aiCreditCycleAllowance({ ...base, override: true, totalSatang: 50_000, row: { monthlyBudgetSatang: 50_000 } }),
      { units: 5_000, source: 'DEFAULT' }, 'a TOTAL override is only the safety ceiling (admin tab rework)');
    assert.deepEqual(aiCreditCycleAllowance({ ...base, row: { budgetMode: 'SPLIT', chatMonthlyBudgetSatang: 30_000, ocrMonthlyBudgetSatang: 10_000 } }),
      { units: 30_000, source: 'SPLIT_CHAT_CAP' });
  });
});


describe('known failed v2 funded invocations are company-absorbed', () => {
  it('releases the hold without month/bucket usage, breach or credit CONSUME, and fences late replay', async () => {
    const modelId = 'apac.anthropic.claude-3-haiku-20240307-v1:0';
    const price = priceRenderedAiInvocationV2({ version: 'test:1', provider: 'bedrock', modelId, region: 'ap-southeast-1', thbPerUsd: 33,
      usdPerMTok: { input: 0.25, output: 1.25, cacheRead: 0.03, cacheWrite: 0.3 } }, 4096, 2048)!;
    const fixture = splitPrisma({ total: 10000, chat: 5000, ocr: 5000, spentChat: 19 }, {
      aiCreditEntry: { findMany: async () => assert.fail('failed calls must never consume credit') },
    });
    const key = 'co#attempt#provider-v2#0';
    fixture.reservations.set('hold', { id: 'hold', companyId: 'co', monthKey: '2026-10', bucket: 'CHAT', stepKind: 'provider-v2',
      invocationKey: key, status: 'DISPATCHED', upperBoundSatang: price.upperBoundSatang,
      pricingSnapshot: { ...price.snapshot, aiCredit: { cycleKey: 'cycle' } } });
    const before = structuredClone(fixture.monthUsage);
    const input = { invocationKey: key, meta: { sourceRoute: 'line-ai-v2' },
      entry: { tag: 'line.loop', modelId, ok: false, inputTokens: 1000, outputTokens: 100,
        cacheReadInputTokens: 0, cacheWriteInputTokens: 0, durationMs: 1, usageBasis: 'CONSERVATIVE_ESTIMATE' as const } };
    assert.equal(await settleAiBudgetStep(fixture.prisma, input), 'settled');
    const hold = fixture.reservations.get('hold');
    assert.equal(hold.status, 'CANCELLED', 'CANCELLED is the existing released-credit status');
    assert.equal(hold.settledCostSatang, 0);
    assert.equal(hold.breach, false);
    assert.equal(hold.usageBasis, 'COMPANY_ABSORBED');
    assert.deepEqual(fixture.monthUsage, before);
    assert.equal(fixture.buckets.get('CHAT')!.costSatang, 19);
    assert.ok(fixture.events.get(key).costSatang > 0, 'company cost evidence survives');
    assert.equal(await settleAiBudgetStep(fixture.prisma, input), 'duplicate');
    assert.equal(fixture.events.size, 1);
  });
});
