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
import { AI_BUDGET_STEP_BOUNDS, aiBudgetInvocationKey } from '@watchdog-bms/contracts';
import {
  AI_BUDGET_DISPATCHED_SWEEP_MS,
  AI_BUDGET_RESERVED_SWEEP_MS,
  aiBudgetAttemptHash,
  cancelAiBudgetStep,
  decideAiBudgetStep,
  markAiBudgetStepDispatched,
  reserveAiBudgetStep,
  settleAiBudgetStep,
} from './company-ai-budget-reservation';

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
