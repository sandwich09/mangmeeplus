/**
 * Real-PostgreSQL proof for the SPLIT money hold (remediation spec §13 E-04/E-06/E-07, R-03…R-06).
 *
 * A fake cannot prove any of this: the invariant "spent + reserved never exceeds the TOTAL or
 * either bucket cap" is a property of `pg_advisory_xact_lock` plus a real unique index under real
 * concurrency, and so are "exactly once" settlement and "no deadlock against the config writer".
 *
 * Gated like every other `*.pg.spec.ts` (skip without the URL, fail when CI names a database), and
 * it refuses to run against anything but an explicit local host.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../../generated/prisma/client';
import { pgSpecUnreachableReason } from '../../../common/database/pg-spec-guard';
import type { AppConfigService } from '../../../common/config/app-config.service';
import type { PrismaService } from '../../../common/database/prisma.service';
import { aiBudgetPolicyRevision } from './company-ai-budget-policy';
import { recordCompanyAiUsage, recordCompanyAiCostAdjustment } from './company-ai-usage-meter';
import {
  AI_BUDGET_DISPATCHED_SWEEP_MS,
  AI_BUDGET_RESERVED_SWEEP_MS,
  cancelAiBudgetStep,
  markAiBudgetStepDispatched,
  readAiBudgetMonthSnapshot,
  reserveAiBudgetStep,
  settleAiBudgetStep,
} from './company-ai-budget-reservation';
import { SetPartnerAiModelUseCase } from '../../system-partner-management/application/use-cases/set-partner-ai-model.use-case';
import { SetPlatformAiBudgetUseCase } from '../../system-partner-management/application/use-cases/set-platform-ai-budget.use-case';

const databaseUrl = process.env.AI_BUDGET_RESERVATION_TEST_DATABASE_URL;

/** Haiku, so the declared bounds price to small whole satang the caps can be built out of. */
const HAIKU = 'apac.anthropic.claude-3-haiku-20240307-v1:0';
/** From the asserted feasibility table in `ai-model-pricing.spec.ts` at FX 33. */
const CHAT_BOUND = 21; // 'crm-intake'
const OCR_BOUND = 47;  // 'bank-statement'
const CHAT_ADMITS = 4;
const OCR_ADMITS = 3;
const CHAT_CAP = CHAT_BOUND * CHAT_ADMITS;          // 84
const OCR_CAP = OCR_BOUND * OCR_ADMITS;             // 141
const TOTAL_CAP = CHAT_CAP + OCR_CAP;               // 225 — the total never cuts before the buckets

const MONTH = '2026-09';

describe('AI budget reservations on PostgreSQL', { skip: !databaseUrl }, () => {
  const tag = `ai-budget-${randomUUID().slice(0, 8)}`;
  const userId = `${tag}-user`;
  let client: PrismaClient;
  let prisma: PrismaService;
  let unreachable: string | null = null;
  /** `PlatformAiBudgetConfig` is a SINGLETON row shared with every sibling spec in the CI database,
   *  so the one test that needs it borrows it and `after()` puts it back exactly as it was. */
  let platformRowBefore: { monthlyBudgetSatang: number; ceilingSatang: number } | null | undefined;

  const config = {
    aiMonthlyBudgetSatang: 1_000_000,
    aiMonthlyBudgetSatangCeiling: 10_000_000,
    approvedAiModelIds: [HAIKU],
    aiBudgetSplitActivationEnabled: true,
    receiptQuotaEnforced: false,
    isProduction: false,
  } as unknown as AppConfigService;

  /** One company per case, so concurrency inside a case cannot be polluted by a neighbour. */
  async function company(suffix: string, policy: { chat?: number | null; ocr?: number | null; total?: number | null; mode?: string } = {}) {
    const companyId = `${tag}-${suffix}`;
    await client.company.create({ data: { id: companyId, name: companyId, businessCategory: 'SERVICE' } });
    await client.companyAiConfiguration.create({
      data: {
        companyId,
        // `total: null` = this company INHERITS the platform default, which is the only case that
        // needs the platform-wide advisory lock.
        monthlyBudgetSatang: policy.total === undefined ? TOTAL_CAP : policy.total,
        modelId: HAIKU,
        budgetMode: policy.mode ?? 'SPLIT',
        chatMonthlyBudgetSatang: policy.chat === undefined ? CHAT_CAP : policy.chat,
        ocrMonthlyBudgetSatang: policy.ocr === undefined ? OCR_CAP : policy.ocr,
      },
    });
    return companyId;
  }

  const reserve = (companyId: string, bucket: 'CHAT' | 'OCR', ordinal: number, attempt = `${bucket}-${ordinal}`) =>
    reserveAiBudgetStep(prisma, config, {
      companyId, monthKey: MONTH, bucket,
      stepKind: bucket === 'CHAT' ? 'crm-intake' : 'bank-statement',
      attemptKey: attempt, ordinal: 0, sourceRoute: bucket === 'CHAT' ? 'crm-intake' : 'bank-statement-extract',
      modelId: HAIKU, thbPerUsd: 33, thbPerUsdSource: 'stored',
    });

  const evidence = (over: Record<string, unknown> = {}) => ({
    modelId: HAIKU, tag: 'crm.intake', ok: true,
    inputTokens: 1_000, outputTokens: 100, cacheReadInputTokens: 0, cacheWriteInputTokens: 0,
    usageBasis: 'PROVIDER_REPORTED', ...over,
  }) as never;

  before(async () => {
    const url = new URL(databaseUrl!);
    assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname), 'requires an explicit local test database');
    // 20 concurrent interactive transactions need a pool that can hold them.
    // 20 concurrent interactive transactions need a pool that can hold them, plus a little slack
    // for the outer client. Well inside the default `max_connections` of 100, and this spec is its
    // own sequential `tsx --test` invocation in CI, so it never competes with a sibling.
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl!, max: 25 }) });
    prisma = { client } as unknown as PrismaService;
    unreachable = await pgSpecUnreachableReason(() => client.$queryRaw`SELECT 1`, 'AI_BUDGET_RESERVATION_REQUIRE_POSTGRES');
    if (unreachable) return;
    await client.user.create({ data: { id: userId, displayName: 'Synthetic budget admin', status: 'ACTIVE' } });
  });

  after(async () => {
    if (!client) return;
    try {
      if (!unreachable) {
        const where = { companyId: { startsWith: tag } };
        await client.aiBudgetReservation.deleteMany({ where });
        await client.aiUsageEvent.deleteMany({ where });
        await client.companyAiMonthlyBucketUsage.deleteMany({ where });
        await client.companyAiMonthlyUsage.deleteMany({ where });
        await client.auditLog.deleteMany({ where });
        await client.companyAiConfiguration.deleteMany({ where });
        await client.company.deleteMany({ where: { id: { startsWith: tag } } });
        await client.user.delete({ where: { id: userId } });
        if (platformRowBefore === null) await client.platformAiBudgetConfig.deleteMany({ where: { id: 'platform' } });
        else if (platformRowBefore) await client.platformAiBudgetConfig.update({ where: { id: 'platform' }, data: platformRowBefore });
      }
    } finally {
      await client.$disconnect();
    }
  });

  it('E-04: 20 concurrent reserves across both buckets never exceed the TOTAL or either cap', async (t) => {
    if (unreachable) return t.skip(unreachable);
    const companyId = await company('concurrent');

    const outcomes = await Promise.all([
      ...Array.from({ length: 10 }, (_, i) => reserve(companyId, 'CHAT', i)),
      ...Array.from({ length: 10 }, (_, i) => reserve(companyId, 'OCR', i)),
    ]);

    const admitted = outcomes.filter((o) => o.ok);
    const chat = admitted.filter((o) => o.ok && o.reservation.bucket === 'CHAT');
    const ocr = admitted.filter((o) => o.ok && o.reservation.bucket === 'OCR');
    const position = await client.$transaction((tx) => readAiBudgetMonthSnapshot(tx, companyId, MONTH));

    assert.equal(chat.length, CHAT_ADMITS, `exactly ${CHAT_ADMITS} CHAT holds fit in ${CHAT_CAP} satang`);
    assert.equal(ocr.length, OCR_ADMITS, `exactly ${OCR_ADMITS} OCR holds fit in ${OCR_CAP} satang`);
    assert.ok(position.reserved.CHAT + position.spent.CHAT <= CHAT_CAP, 'CHAT invariant');
    assert.ok(position.reserved.OCR + position.spent.OCR <= OCR_CAP, 'OCR invariant');
    assert.ok(position.reserved.TOTAL + position.spent.TOTAL <= TOTAL_CAP, 'TOTAL invariant');
    // Every refusal is typed, and none of them is an unmetered pass.
    for (const refused of outcomes.filter((o) => !o.ok)) {
      assert.ok(['insufficient', 'exceeded'].includes((refused as { reason: string }).reason), JSON.stringify(refused));
      assert.ok(['CHAT', 'OCR', 'TOTAL'].includes((refused as { budgetScope: string }).budgetScope));
    }
  });

  it('R-03: a duplicate invocation key is already_claimed, never a second hold', async (t) => {
    if (unreachable) return t.skip(unreachable);
    const companyId = await company('duplicate');

    const first = await reserve(companyId, 'CHAT', 0, 'same-attempt');
    const second = await reserve(companyId, 'CHAT', 0, 'same-attempt');
    const concurrent = await Promise.all(Array.from({ length: 5 }, () => reserve(companyId, 'CHAT', 0, 'race-attempt')));

    assert.equal(first.ok, true);
    assert.equal((second as { reason: string }).reason, 'already_claimed');
    assert.equal((second as { status: string }).status, 'RESERVED');
    assert.equal(concurrent.filter((o) => o.ok).length, 1, 'a concurrent duplicate buys exactly one hold');
    assert.equal(await client.aiBudgetReservation.count({ where: { companyId, attemptKey: 'race-attempt' } }), 1);
  });

  it('E-07: concurrent settlement of one invocation writes ONE event and moves the aggregates once', async (t) => {
    if (unreachable) return t.skip(unreachable);
    const companyId = await company('settle-once', { total: 100_000, chat: 50_000, ocr: 50_000 });
    const held = await reserve(companyId, 'CHAT', 0, 'settle-attempt');
    assert.ok(held.ok);
    assert.equal(await markAiBudgetStepDispatched(prisma, held.reservation.id, held.reservation.ownerToken), true);

    const results = await Promise.all(Array.from({ length: 6 }, () => settleAiBudgetStep(prisma, {
      invocationKey: held.reservation.invocationKey, entry: evidence(), meta: { sourceRoute: 'crm-intake', requestId: 'req-1' },
    })));

    assert.equal(results.filter((r) => r === 'settled').length, 1, 'exactly one settlement');
    assert.ok(results.filter((r) => r === 'duplicate').length >= 1);
    assert.equal(await client.aiUsageEvent.count({ where: { invocationKey: held.reservation.invocationKey } }), 1);
    const month = await client.companyAiMonthlyUsage.findUniqueOrThrow({ where: { companyId_monthKey: { companyId, monthKey: MONTH } } });
    const bucket = await client.companyAiMonthlyBucketUsage.findUniqueOrThrow({
      where: { companyId_monthKey_bucket: { companyId, monthKey: MONTH, bucket: 'CHAT' } },
    });
    assert.equal(month.callCount, 1);
    assert.equal(bucket.callCount, 1);
    assert.equal(bucket.costSatang, month.costSatang, 'the bucket slice and the month total agree');
    const row = await client.aiBudgetReservation.findUniqueOrThrow({ where: { id: held.reservation.id } });
    assert.equal(row.status, 'SETTLED');
    assert.equal(row.settledCostSatang, month.costSatang);
    assert.equal(row.breach, false);
  });

  it('R-06: a reserve racing the E1a cap writer 50x never deadlocks and keeps the invariant', async (t) => {
    if (unreachable) return t.skip(unreachable);
    const companyId = await company('writer-race', { total: 1_000_000, chat: 500_000, ocr: 500_000 });
    const writer = new SetPartnerAiModelUseCase(prisma, config);
    const errors: string[] = [];

    for (let round = 0; round < 50; round += 1) {
      const row = await client.companyAiConfiguration.findUniqueOrThrow({ where: { companyId } });
      const [, saved] = await Promise.allSettled([
        reserve(companyId, 'CHAT', round, `race-${round}`),
        // Raising a cap is always legal; the point is the LOCK ORDER, not the validation.
        writer.execute({
          companyId, requestingAdminUserId: userId, requestId: randomUUID(), reason: 'pg concurrency proof',
          expectedBudgetRevision: aiBudgetPolicyRevision(row, MONTH),
          budgetPolicy: {
            mode: 'SPLIT', chatMonthlyBudgetSatang: 500_000 + round + 1,
            ocrMonthlyBudgetSatang: 500_000, effectiveMonthKey: MONTH,
          },
          now: new Date(`${MONTH}-15T00:00:00Z`),
        } as never),
      ]);
      if (saved.status === 'rejected') errors.push(String((saved.reason as Error).message).slice(0, 120));
    }

    // A deadlock surfaces as SQLSTATE 40P01. Any other rejection is a validation answer, not a hang.
    assert.equal(errors.filter((message) => message.includes('40P01') || /deadlock/i.test(message)).length, 0, errors.join(' | '));
    const position = await client.$transaction((tx) => readAiBudgetMonthSnapshot(tx, companyId, MONTH));
    const final = await client.companyAiConfiguration.findUniqueOrThrow({ where: { companyId } });
    assert.ok(position.reserved.CHAT <= final.chatMonthlyBudgetSatang!, 'holds never exceed the live cap');
  });

  it('E-09: the writer refuses a cap below spent + reserved of that bucket', async (t) => {
    if (unreachable) return t.skip(unreachable);
    const companyId = await company('cap-floor', { total: 100_000, chat: 50_000, ocr: 50_000 });
    const held = await reserve(companyId, 'CHAT', 0, 'floor-attempt');
    assert.ok(held.ok);
    const writer = new SetPartnerAiModelUseCase(prisma, config);
    const row = await client.companyAiConfiguration.findUniqueOrThrow({ where: { companyId } });

    await assert.rejects(
      () => writer.execute({
        companyId, requestingAdminUserId: userId, requestId: randomUUID(), reason: 'lower below the hold',
        expectedBudgetRevision: aiBudgetPolicyRevision(row, MONTH),
        budgetPolicy: { mode: 'SPLIT', chatMonthlyBudgetSatang: held.reservation.upperBoundSatang - 1, ocrMonthlyBudgetSatang: 50_000, effectiveMonthKey: MONTH },
        now: new Date(`${MONTH}-15T00:00:00Z`),
      } as never),
      /partner_ai_budget_cap_below_bucket_spend/,
    );
  });

  it('spec §12.5: the PINNED month absorbs a settlement made after Bangkok midnight', async (t) => {
    if (unreachable) return t.skip(unreachable);
    const companyId = await company('month-pin', { total: 100_000, chat: 50_000, ocr: 50_000 });
    const held = await reserve(companyId, 'CHAT', 0, 'pinned-attempt');
    assert.ok(held.ok);
    await markAiBudgetStepDispatched(prisma, held.reservation.id, held.reservation.ownerToken);

    // Settle "in the next month": the reservation's own month is the only one that may move.
    assert.equal(await settleAiBudgetStep(prisma, {
      invocationKey: held.reservation.invocationKey, entry: evidence(),
      meta: { sourceRoute: 'crm-intake' }, now: new Date('2026-10-01T00:30:00+07:00'),
    }), 'settled');

    assert.equal(await client.companyAiMonthlyUsage.count({ where: { companyId, monthKey: '2026-10' } }), 0);
    assert.equal(await client.companyAiMonthlyBucketUsage.count({ where: { companyId, monthKey: '2026-10' } }), 0);
    const event = await client.aiUsageEvent.findUniqueOrThrow({ where: { invocationKey: held.reservation.invocationKey } });
    assert.equal(event.monthKey, MONTH);
    assert.equal(event.budgetBucket, 'CHAT');
  });

  it('E-07: a late settlement closes an UNRESOLVED hold; a swept RESERVED hold is CANCELLED', async (t) => {
    if (unreachable) return t.skip(unreachable);
    const companyId = await company('sweep', { total: 100_000, chat: 50_000, ocr: 50_000 });
    const stale = await reserve(companyId, 'CHAT', 0, 'never-dispatched');
    const inFlight = await reserve(companyId, 'CHAT', 1, 'dispatched-lost');
    assert.ok(stale.ok && inFlight.ok);
    await markAiBudgetStepDispatched(prisma, inFlight.reservation.id, inFlight.reservation.ownerToken);
    // Age both past their thresholds, then let the NEXT reserve of this company-month sweep them.
    const old = new Date(Date.now() - AI_BUDGET_DISPATCHED_SWEEP_MS - AI_BUDGET_RESERVED_SWEEP_MS - 60_000);
    await client.aiBudgetReservation.update({ where: { id: stale.reservation.id }, data: { createdAt: old } });
    await client.aiBudgetReservation.update({ where: { id: inFlight.reservation.id }, data: { createdAt: old, dispatchedAt: old } });

    await reserve(companyId, 'CHAT', 2, 'sweeper');

    const swept = await client.aiBudgetReservation.findUniqueOrThrow({ where: { id: stale.reservation.id } });
    const unresolved = await client.aiBudgetReservation.findUniqueOrThrow({ where: { id: inFlight.reservation.id } });
    assert.equal(swept.status, 'CANCELLED');
    assert.deepEqual(swept.evidenceJson, { proof: 'never_dispatched', sweptAt: (swept.evidenceJson as { sweptAt: string }).sweptAt });
    assert.equal(unresolved.status, 'UNRESOLVED', 'a dispatched hold is NEVER released on a timer');

    // Late evidence for the UNRESOLVED hold still settles — that is what closes it.
    assert.equal(await settleAiBudgetStep(prisma, {
      invocationKey: inFlight.reservation.invocationKey, entry: evidence(), meta: { sourceRoute: 'crm-intake' },
    }), 'settled');
    assert.equal((await client.aiBudgetReservation.findUniqueOrThrow({ where: { id: inFlight.reservation.id } })).status, 'SETTLED');
    // ...and if real provider evidence STILL arrives for the cancelled one, the money is recorded
    // in full as an anomaly rather than dropped (review item 2 / spec §12.6 "usage หาย").
    assert.equal(await settleAiBudgetStep(prisma, {
      invocationKey: stale.reservation.invocationKey, entry: evidence(), meta: { sourceRoute: 'crm-intake' },
    }), 'settled-anomaly');
    const reopened = await client.aiBudgetReservation.findUniqueOrThrow({ where: { id: stale.reservation.id } });
    assert.equal(reopened.status, 'SETTLED');
    assert.deepEqual((reopened.evidenceJson as { anomaly: unknown }).anomaly, { previousStatus: 'CANCELLED' });
  });

  it('spec §12.3: an actual above the bound records in FULL, flags a breach and closes the scope', async (t) => {
    if (unreachable) return t.skip(unreachable);
    const companyId = await company('breach', { total: 1_000_000, chat: 500_000, ocr: 500_000 });
    const held = await reserve(companyId, 'CHAT', 0, 'breach-attempt');
    assert.ok(held.ok);
    await markAiBudgetStepDispatched(prisma, held.reservation.id, held.reservation.ownerToken);

    // Far more tokens than the declared bound priced, so the actual must exceed the hold.
    assert.equal(await settleAiBudgetStep(prisma, {
      invocationKey: held.reservation.invocationKey,
      entry: evidence({ inputTokens: 5_000_000, outputTokens: 500_000 }), meta: { sourceRoute: 'crm-intake' },
    }), 'settled');

    const row = await client.aiBudgetReservation.findUniqueOrThrow({ where: { id: held.reservation.id } });
    assert.equal(row.breach, true);
    assert.ok(row.settledCostSatang! > row.upperBoundSatang, 'the FULL actual is recorded, never clamped to the bound');
    const event = await client.aiUsageEvent.findUniqueOrThrow({ where: { invocationKey: held.reservation.invocationKey } });
    assert.equal(event.costSatang, row.settledCostSatang);

    // CHAT is now closed for this company-month; OCR is untouched.
    const chatAfter = await reserve(companyId, 'CHAT', 1, 'after-breach');
    const ocrAfter = await reserve(companyId, 'OCR', 0, 'after-breach-ocr');
    assert.equal((chatAfter as { reason: string }).reason, 'unavailable');
    assert.equal((chatAfter as { detail: string }).detail, 'invariant_breach');
    assert.equal(ocrAfter.ok, true, 'a breach in one bucket does not close the other');
  });

  it('R-04/R-05: cancel needs the owner token, and only a no-provider proof frees a dispatched hold', async (t) => {
    if (unreachable) return t.skip(unreachable);
    const companyId = await company('cancel', { total: 100_000, chat: 50_000, ocr: 50_000 });
    const a = await reserve(companyId, 'CHAT', 0, 'cancel-reserved');
    const b = await reserve(companyId, 'CHAT', 1, 'cancel-dispatched');
    assert.ok(a.ok && b.ok);
    await markAiBudgetStepDispatched(prisma, b.reservation.id, b.reservation.ownerToken);

    assert.equal(await cancelAiBudgetStep(prisma, { reservationId: a.reservation.id, ownerToken: 'not-the-owner', proof: 'never_dispatched' }), false);
    assert.equal((await client.aiBudgetReservation.findUniqueOrThrow({ where: { id: a.reservation.id } })).status, 'RESERVED');
    assert.equal(await cancelAiBudgetStep(prisma, { reservationId: a.reservation.id, ownerToken: a.reservation.ownerToken, proof: 'never_dispatched' }), true);
    // `never_dispatched` is the sweep's proof and may not touch a DISPATCHED row.
    assert.equal(await cancelAiBudgetStep(prisma, { reservationId: b.reservation.id, ownerToken: b.reservation.ownerToken, proof: 'never_dispatched' }), false);
    assert.equal(await cancelAiBudgetStep(prisma, { reservationId: b.reservation.id, ownerToken: b.reservation.ownerToken, proof: 'ocr_admission_refused' }), true);

    const position = await client.$transaction((tx) => readAiBudgetMonthSnapshot(tx, companyId, MONTH));
    assert.equal(position.reserved.CHAT, 0, 'both proven no-provider holds are released');
  });

  it('a SHARED company still fills the bucket aggregate, and an adjustment moves it back', async (t) => {
    if (unreachable) return t.skip(unreachable);
    const companyId = await company('shared', { mode: 'SHARED', chat: null, ocr: null, total: 100_000 });

    await recordCompanyAiUsage(prisma, config, {
      companyId, sourceRoute: 'receipt-ocr', monthKey: MONTH, requestKind: 'IMAGE', budgetBucket: 'OCR',
    }, [evidence({ tag: 'ocr.receipt.image-read' })]);

    const before = await client.companyAiMonthlyBucketUsage.findUniqueOrThrow({
      where: { companyId_monthKey_bucket: { companyId, monthKey: MONTH, bucket: 'OCR' } },
    });
    assert.ok(before.costSatang > 0);
    assert.equal(before.callCount, 1);

    const event = await client.aiUsageEvent.findFirstOrThrow({ where: { companyId, eventKind: 'MODEL_CALL' } });
    assert.equal(await recordCompanyAiCostAdjustment(prisma, {
      eventId: event.id, correctionKey: `${tag}-correction`, costSatang: -1,
    }), 'applied');

    const after = await client.companyAiMonthlyBucketUsage.findUniqueOrThrow({
      where: { companyId_monthKey_bucket: { companyId, monthKey: MONTH, bucket: 'OCR' } },
    });
    assert.equal(after.costSatang, before.costSatang - 1);
    assert.equal(after.callCount, 1, 'a correction is never a provider call');
  });

  it('refuses to reserve for a SHARED or invalid policy — SPLIT is the only reservable mode', async (t) => {
    if (unreachable) return t.skip(unreachable);
    const shared = await company('reserve-shared', { mode: 'SHARED', chat: null, ocr: null });
    const broken = await company('reserve-broken', { mode: 'SPLIT', chat: 900_000, ocr: 900_000, total: 1_000 });

    assert.equal(((await reserve(shared, 'CHAT', 0)) as { detail: string }).detail, 'policy_not_split');
    assert.equal(((await reserve(broken, 'CHAT', 0)) as { detail: string }).detail, 'SPLIT_EXCEEDS_TOTAL');
  });

  // ── Controller review follow-ups 1, 2, 3 and 5 ─────────────────────────────

  it('item 1: 50 rounds of concurrent settle + record + adjust never deadlock and lose nothing', async (t) => {
    if (unreachable) return t.skip(unreachable);
    const companyId = await company('row-order', { total: 100_000_000, chat: 50_000_000, ocr: 50_000_000 });
    const deadlocks: string[] = [];
    let settled = 0;
    let recorded = 0;

    for (let round = 0; round < 50; round += 1) {
      // One SPLIT company, one month, one bucket: a settle (month row then bucket row) racing a
      // plain recording of un-enveloped chain usage (same order since the fix) plus a correction.
      // Before the fix the two took the two aggregate rows in OPPOSITE order and Postgres killed
      // one of them — and the victim's usage was warned about, never retried.
      const held = await reserve(companyId, 'CHAT', round, `row-order-${round}`);
      assert.ok(held.ok);
      await markAiBudgetStepDispatched(prisma, held.reservation.id, held.reservation.ownerToken);
      const outcomes = await Promise.allSettled([
        settleAiBudgetStep(prisma, {
          invocationKey: held.reservation.invocationKey, entry: evidence(),
          meta: { sourceRoute: 'crm-intake', requestId: `req-${round}` },
        }),
        recordCompanyAiUsage(prisma, config, {
          companyId, sourceRoute: 'crm-intake', monthKey: MONTH, requestKind: 'TEXT', budgetBucket: 'CHAT',
          requestId: `rest-${round}`,
        }, [evidence({ tag: 'crm.intake.rest' })]),
      ]);
      for (const outcome of outcomes) {
        if (outcome.status === 'rejected') deadlocks.push(String((outcome.reason as Error).message).slice(0, 160));
      }
      if (outcomes[0]!.status === 'fulfilled' && (outcomes[0] as PromiseFulfilledResult<string>).value === 'settled') settled += 1;
      if (outcomes[1]!.status === 'fulfilled') recorded += 1;
    }

    assert.equal(deadlocks.filter((m) => m.includes('40P01') || /deadlock/i.test(m)).length, 0, deadlocks.join(' | '));
    assert.equal(deadlocks.length, 0, `no transaction may fail at all: ${deadlocks.join(' | ')}`);
    assert.equal(settled, 50, 'every settlement recorded');
    assert.equal(recorded, 50, 'every plain recording succeeded');

    // Exactly 100 provider rows, and the two aggregates agree to the satang.
    const events = await client.aiUsageEvent.findMany({ where: { companyId, eventKind: 'MODEL_CALL' }, select: { costSatang: true } });
    assert.equal(events.length, 100, 'no usage was lost');
    const month = await client.companyAiMonthlyUsage.findUniqueOrThrow({ where: { companyId_monthKey: { companyId, monthKey: MONTH } } });
    const bucket = await client.companyAiMonthlyBucketUsage.findUniqueOrThrow({
      where: { companyId_monthKey_bucket: { companyId, monthKey: MONTH, bucket: 'CHAT' } },
    });
    const expected = events.reduce((sum, row) => sum + row.costSatang, 0);
    assert.equal(month.costSatang, expected);
    assert.equal(month.callCount, 100);
    assert.equal(bucket.costSatang, expected, 'the bucket slice equals the month total');
    assert.equal(bucket.callCount, 100);

    // ...and one correction moves BOTH aggregates by the same signed delta, same row order.
    const one = await client.aiUsageEvent.findFirstOrThrow({ where: { companyId, eventKind: 'MODEL_CALL' } });
    assert.equal(await recordCompanyAiCostAdjustment(prisma, {
      eventId: one.id, correctionKey: `${tag}-row-order-correction`, costSatang: -7,
    }), 'applied');
    const monthAfter = await client.companyAiMonthlyUsage.findUniqueOrThrow({ where: { companyId_monthKey: { companyId, monthKey: MONTH } } });
    const bucketAfter = await client.companyAiMonthlyBucketUsage.findUniqueOrThrow({
      where: { companyId_monthKey_bucket: { companyId, monthKey: MONTH, bucket: 'CHAT' } },
    });
    assert.equal(monthAfter.costSatang, expected - 7);
    assert.equal(bucketAfter.costSatang, expected - 7);
    assert.equal(monthAfter.callCount, 100, 'a correction is never a provider call');
  });

  it('item 2: provider evidence for a RESERVED or CANCELLED hold is recorded in FULL with an anomaly', async (t) => {
    if (unreachable) return t.skip(unreachable);
    const companyId = await company('anomaly', { total: 1_000_000, chat: 500_000, ocr: 500_000 });

    // (a) the dispatch mark was lost: the row is still RESERVED but the provider ran.
    const neverMarked = await reserve(companyId, 'CHAT', 0, 'anomaly-reserved');
    assert.ok(neverMarked.ok);
    assert.equal(await settleAiBudgetStep(prisma, {
      invocationKey: neverMarked.reservation.invocationKey, entry: evidence(), meta: { sourceRoute: 'crm-intake' },
    }), 'settled-anomaly');
    const a = await client.aiBudgetReservation.findUniqueOrThrow({ where: { id: neverMarked.reservation.id } });
    assert.equal(a.status, 'SETTLED');
    assert.ok(a.settledCostSatang! > 0, 'the money is REAL and recorded in full');
    assert.deepEqual((a.evidenceJson as { anomaly: unknown }).anomaly, { previousStatus: 'RESERVED' });
    assert.equal(await client.aiUsageEvent.count({ where: { invocationKey: neverMarked.reservation.invocationKey } }), 1);

    // (b) a cancel proof was wrong: the hold was CANCELLED but the provider ran anyway.
    const wronglyCancelled = await reserve(companyId, 'CHAT', 1, 'anomaly-cancelled');
    assert.ok(wronglyCancelled.ok);
    await markAiBudgetStepDispatched(prisma, wronglyCancelled.reservation.id, wronglyCancelled.reservation.ownerToken);
    assert.equal(await cancelAiBudgetStep(prisma, {
      reservationId: wronglyCancelled.reservation.id, ownerToken: wronglyCancelled.reservation.ownerToken,
      proof: 'gateway_pre_provider_refusal',
    }), true);
    assert.equal(await settleAiBudgetStep(prisma, {
      invocationKey: wronglyCancelled.reservation.invocationKey, entry: evidence(), meta: { sourceRoute: 'crm-intake' },
    }), 'settled-anomaly');
    const b = await client.aiBudgetReservation.findUniqueOrThrow({ where: { id: wronglyCancelled.reservation.id } });
    assert.equal(b.status, 'SETTLED');
    assert.deepEqual((b.evidenceJson as { anomaly: unknown }).anomaly, { previousStatus: 'CANCELLED' });

    // (c) a second settlement of either is a plain duplicate, not a second charge.
    for (const hold of [neverMarked.reservation, wronglyCancelled.reservation]) {
      assert.equal(await settleAiBudgetStep(prisma, {
        invocationKey: hold.invocationKey, entry: evidence(), meta: { sourceRoute: 'crm-intake' },
      }), 'duplicate');
    }
    // (d) malformed evidence still settles nothing, whatever the status.
    const intact = await reserve(companyId, 'CHAT', 2, 'anomaly-malformed');
    assert.ok(intact.ok);
    assert.equal(await settleAiBudgetStep(prisma, {
      invocationKey: intact.reservation.invocationKey, entry: evidence({ inputTokens: -1 }), meta: { sourceRoute: 'crm-intake' },
    }), 'invalid-evidence');
    assert.equal((await client.aiBudgetReservation.findUniqueOrThrow({ where: { id: intact.reservation.id } })).status, 'RESERVED');
  });

  it('item 2: a cancel racing a settle leaves exactly one outcome and never loses the usage', async (t) => {
    if (unreachable) return t.skip(unreachable);
    const companyId = await company('cancel-race', { total: 1_000_000, chat: 500_000, ocr: 500_000 });

    for (let round = 0; round < 20; round += 1) {
      const held = await reserve(companyId, 'CHAT', round, `cancel-race-${round}`);
      assert.ok(held.ok);
      await markAiBudgetStepDispatched(prisma, held.reservation.id, held.reservation.ownerToken);
      // Both take the SAME company-month lock, so one of them observes the other's committed state.
      const [cancelled, settledResult] = await Promise.all([
        cancelAiBudgetStep(prisma, { reservationId: held.reservation.id, ownerToken: held.reservation.ownerToken, proof: 'gateway_pre_provider_refusal' }),
        settleAiBudgetStep(prisma, { invocationKey: held.reservation.invocationKey, entry: evidence(), meta: { sourceRoute: 'crm-intake' } }),
      ]);
      const row = await client.aiBudgetReservation.findUniqueOrThrow({ where: { id: held.reservation.id } });
      // Whoever won, the evidence is recorded and the row is SETTLED: a cancel can never make real
      // provider cost disappear, it can only lose the race or be overridden as an anomaly.
      assert.ok(['settled', 'settled-anomaly'].includes(settledResult), `${settledResult} (cancelled=${cancelled})`);
      assert.equal(row.status, 'SETTLED');
      assert.equal(await client.aiUsageEvent.count({ where: { invocationKey: held.reservation.invocationKey } }), 1);
    }
  });

  it('item 3: an INHERITING company racing the platform-default writer 30x never deadlocks', async (t) => {
    if (unreachable) return t.skip(unreachable);
    // No override => the reserve really does take the platform-wide lock, in canonical order.
    const companyId = await company('inherit', { total: null, chat: 400_000, ocr: 400_000 });
    await client.platformAiBudgetConfig.upsert({
      where: { id: 'platform' },
      create: { id: 'platform', monthlyBudgetSatang: 1_000_000, ceilingSatang: 10_000_000 },
      update: { monthlyBudgetSatang: 1_000_000, ceilingSatang: 10_000_000 },
    });
    platformRowBefore = await client.platformAiBudgetConfig.findUnique({
      where: { id: 'platform' }, select: { monthlyBudgetSatang: true, ceilingSatang: true },
    });
    const platformWriter = new SetPlatformAiBudgetUseCase(prisma, config);
    const errors: string[] = [];

    for (let round = 0; round < 30; round += 1) {
      const [, saved] = await Promise.allSettled([
        reserve(companyId, 'CHAT', round, `inherit-${round}`),
        // RAISING the default is always legal; the point is the lock order, not the validation.
        platformWriter.execute({
          monthlyBudgetSatang: 1_000_000 + round + 1, ceilingSatang: 10_000_000,
          requestingAdminUserId: userId, requestId: randomUUID(),
        }),
      ]);
      if (saved.status === 'rejected') errors.push(String((saved.reason as Error).message).slice(0, 160));
    }

    assert.equal(errors.filter((m) => m.includes('40P01') || /deadlock/i.test(m)).length, 0, errors.join(' | '));
    const position = await client.$transaction((tx) => readAiBudgetMonthSnapshot(tx, companyId, MONTH));
    assert.ok(position.reserved.CHAT > 0, 'the inheriting company really did reserve');
    assert.ok(position.reserved.CHAT <= 400_000, 'and stayed inside its cap');
  });

  it('item 5: requestKind pinned at reserve time lands on a settlement that supplies none', async (t) => {
    if (unreachable) return t.skip(unreachable);
    const companyId = await company('request-kind', { total: 1_000_000, chat: 500_000, ocr: 500_000 });
    const held = await reserveAiBudgetStep(prisma, config, {
      companyId, monthKey: MONTH, bucket: 'OCR', stepKind: 'bank-statement',
      attemptKey: 'statement:import-1', ordinal: 0, sourceRoute: 'bank-statement-extract',
      modelId: HAIKU, requestKind: 'IMAGE', thbPerUsd: 33, thbPerUsdSource: 'stored',
    });
    assert.ok(held.ok);
    await markAiBudgetStepDispatched(prisma, held.reservation.id, held.reservation.ownerToken);

    // Exactly what `POST /internal/ai/budget-settle` posts: no requestKind, because the gateway
    // never classifies a request.
    assert.equal(await settleAiBudgetStep(prisma, {
      invocationKey: held.reservation.invocationKey,
      entry: evidence({ tag: 'ocr.bank-statement' }), meta: { sourceRoute: 'bank-statement-extract' },
    }), 'settled');

    const event = await client.aiUsageEvent.findUniqueOrThrow({ where: { invocationKey: held.reservation.invocationKey } });
    assert.equal(event.requestKind, 'IMAGE', 'inherited from the hold, not UNKNOWN');
    assert.equal(event.budgetBucket, 'OCR');
  });
});
