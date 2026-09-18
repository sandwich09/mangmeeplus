/**
 * Real-PostgreSQL proof for the operator reconciliation of held AI credit (hold spec §4.2, J-04).
 *
 * A fake cannot prove any of this. "Two operators press the button and exactly one wins" is a
 * property of `pg_advisory_xact_lock` plus a fenced `updateMany`; "the charge moves the aggregates
 * once and cannot double-settle" is a property of a real unique index; "acknowledging reopens
 * admission" is a property of the real admission query; and "no deadlock against a concurrent
 * reserve/settle" is only a statement about real lock ordering.
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
import {
  acknowledgeAiBudgetBreach,
  chargeAiBudgetHoldAtBound,
  listAiBudgetCreditHolds,
  markAiBudgetStepDispatched,
  readAiBudgetMonthSnapshot,
  releaseAiBudgetHoldByOperator,
  reserveAiBudgetStep,
  settleAiBudgetStep,
  sweepAiBudgetCompanyMonth,
  AI_BUDGET_DISPATCHED_SWEEP_MS,
} from './company-ai-budget-reservation';

const databaseUrl = process.env.AI_CREDIT_HOLDS_TEST_DATABASE_URL;

/** Haiku, so the declared bounds price to small whole satang the caps can be built out of. */
const HAIKU = 'apac.anthropic.claude-3-haiku-20240307-v1:0';
/** From the asserted feasibility table in `ai-model-pricing.spec.ts` at FX 33. */
const CHAT_BOUND = 21; // 'crm-intake'
const OCR_BOUND = 47;  // 'bank-statement'
const MONTH = '2026-09';

describe('AI credit hold reconciliation on PostgreSQL', { skip: !databaseUrl }, () => {
  const tag = `ai-holds-${randomUUID().slice(0, 8)}`;
  const userId = `${tag}-user`;
  let client: PrismaClient;
  let prisma: PrismaService;
  let unreachable: string | null = null;

  const config = {
    aiMonthlyBudgetSatang: 1_000_000,
    aiMonthlyBudgetSatangCeiling: 10_000_000,
    approvedAiModelIds: [HAIKU],
    aiBudgetSplitActivationEnabled: true,
    receiptQuotaEnforced: false,
    isProduction: false,
  } as unknown as AppConfigService;

  /** One company per case, so a decision in one cannot disturb another's invariants. */
  async function company(suffix: string, policy: { chat?: number; ocr?: number; total?: number } = {}) {
    const companyId = `${tag}-${suffix}`;
    await client.company.create({ data: { id: companyId, name: companyId, businessCategory: 'SERVICE' } });
    await client.companyAiConfiguration.create({
      data: {
        companyId, monthlyBudgetSatang: policy.total ?? 100_000, modelId: HAIKU, budgetMode: 'SPLIT',
        chatMonthlyBudgetSatang: policy.chat ?? 50_000, ocrMonthlyBudgetSatang: policy.ocr ?? 50_000,
      },
    });
    return companyId;
  }

  const reserve = (companyId: string, bucket: 'CHAT' | 'OCR', attempt: string) =>
    reserveAiBudgetStep(prisma, config, {
      companyId, monthKey: MONTH, bucket,
      stepKind: bucket === 'CHAT' ? 'crm-intake' : 'bank-statement',
      attemptKey: attempt, ordinal: 0,
      sourceRoute: bucket === 'CHAT' ? 'crm-intake' : 'bank-statement-extract',
      requestKind: bucket === 'CHAT' ? 'TEXT' : 'IMAGE',
      modelId: HAIKU, thbPerUsd: 33, thbPerUsdSource: 'stored',
    });

  /** Reserve, dispatch and then age the row so the sweep turns it into a real stranded hold. */
  async function stranded(companyId: string, bucket: 'CHAT' | 'OCR', attempt: string) {
    const held = await reserve(companyId, bucket, attempt);
    assert.ok(held.ok, JSON.stringify(held));
    assert.equal(await markAiBudgetStepDispatched(prisma, held.reservation.id, held.reservation.ownerToken), true);
    const old = new Date(Date.now() - AI_BUDGET_DISPATCHED_SWEEP_MS - 60_000);
    await client.aiBudgetReservation.update({ where: { id: held.reservation.id }, data: { createdAt: old, dispatchedAt: old } });
    assert.equal(await sweepAiBudgetCompanyMonth(prisma, companyId, MONTH), true);
    const row = await client.aiBudgetReservation.findUniqueOrThrow({ where: { id: held.reservation.id } });
    assert.equal(row.status, 'UNRESOLVED', 'the sweep must have stranded it, never released it');
    return held.reservation;
  }

  const evidence = (over: Record<string, unknown> = {}) => ({
    modelId: HAIKU, tag: 'crm.intake', ok: true,
    inputTokens: 1_000, outputTokens: 100, cacheReadInputTokens: 0, cacheWriteInputTokens: 0,
    usageBasis: 'PROVIDER_REPORTED', ...over,
  }) as never;

  const decision = (companyId: string, reservationId: string) => ({
    reservationId, companyId, actorUserId: userId, requestId: randomUUID(),
    reason: 'หลักฐานไม่กลับมา ตรวจกับผู้ให้บริการแล้ว',
  });

  const RELEASE_AUDIT = { action: 'ai.credit_hold.released' };
  const CHARGE_AUDIT = { action: 'ai.credit_hold.charged_at_bound' };
  const ACK_AUDIT = { action: 'ai.credit_breach.acknowledged' };

  before(async () => {
    const url = new URL(databaseUrl!);
    assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname), 'requires an explicit local test database');
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl!, max: 25 }) });
    prisma = { client } as unknown as PrismaService;
    unreachable = await pgSpecUnreachableReason(() => client.$queryRaw`SELECT 1`, 'AI_CREDIT_HOLDS_REQUIRE_POSTGRES');
    if (unreachable) return;
    await client.user.create({ data: { id: userId, displayName: 'Synthetic hold operator', status: 'ACTIVE' } });
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
      }
    } finally {
      await client.$disconnect();
    }
  });

  it('J-04: release frees the credit once — a second press loses the fence, not the money', async (t) => {
    if (unreachable) return t.skip(unreachable);
    const companyId = await company('release');
    const hold = await stranded(companyId, 'OCR', 'release-attempt');
    const before = await client.$transaction((tx) => readAiBudgetMonthSnapshot(tx, companyId, MONTH));
    assert.equal(before.reserved.OCR, OCR_BOUND);
    assert.equal(before.unresolvedHolds, 1);

    // Two operators, at the same moment, on the same row.
    const outcomes = await Promise.all([
      releaseAiBudgetHoldByOperator(prisma, decision(companyId, hold.id), RELEASE_AUDIT),
      releaseAiBudgetHoldByOperator(prisma, decision(companyId, hold.id), RELEASE_AUDIT),
    ]);

    assert.equal(outcomes.filter((o) => o.ok).length, 1, 'exactly one winner');
    assert.deepEqual(outcomes.filter((o) => !o.ok).map((o) => (o as { reason: string }).reason), ['already-resolved']);
    const row = await client.aiBudgetReservation.findUniqueOrThrow({ where: { id: hold.id } });
    assert.equal(row.status, 'CANCELLED');
    assert.equal((row.evidenceJson as { proof: string }).proof, 'operator_released');
    // The credit is free and NO usage was invented.
    const after = await client.$transaction((tx) => readAiBudgetMonthSnapshot(tx, companyId, MONTH));
    assert.equal(after.reserved.OCR, 0);
    assert.equal(after.unresolvedHolds, 0);
    assert.equal(after.spent.TOTAL, 0);
    assert.equal(await client.aiUsageEvent.count({ where: { companyId } }), 0);
    // Exactly ONE audit/history row, from the winner only.
    const audits = await client.auditLog.findMany({ where: { companyId, action: 'ai.credit_hold.released' } });
    assert.equal(audits.length, 1);
    assert.equal((audits[0]!.metadataJson as { releasedSatang: number }).releasedSatang, OCR_BOUND);
  });

  it('J-04: a third press after release is still refused, and a sixth is still one row', async (t) => {
    if (unreachable) return t.skip(unreachable);
    const companyId = await company('release-storm');
    const hold = await stranded(companyId, 'CHAT', 'storm-attempt');

    const outcomes = await Promise.all(Array.from({ length: 6 }, () =>
      releaseAiBudgetHoldByOperator(prisma, decision(companyId, hold.id), RELEASE_AUDIT)));

    assert.equal(outcomes.filter((o) => o.ok).length, 1);
    assert.equal(await client.auditLog.count({ where: { companyId, action: 'ai.credit_hold.released' } }), 1);
  });

  it('J-04: charge-at-bound moves the month AND bucket aggregates exactly once', async (t) => {
    if (unreachable) return t.skip(unreachable);
    const companyId = await company('charge');
    const hold = await stranded(companyId, 'OCR', 'charge-attempt');

    const outcomes = await Promise.all(Array.from({ length: 6 }, () =>
      chargeAiBudgetHoldAtBound(prisma, decision(companyId, hold.id), CHARGE_AUDIT)));

    assert.equal(outcomes.filter((o) => o.ok).length, 1, 'exactly one charge');
    assert.deepEqual(new Set(outcomes.filter((o) => !o.ok).map((o) => (o as { reason: string }).reason)),
      new Set(['already-resolved']));
    const month = await client.companyAiMonthlyUsage.findUniqueOrThrow({ where: { companyId_monthKey: { companyId, monthKey: MONTH } } });
    const bucket = await client.companyAiMonthlyBucketUsage.findUniqueOrThrow({
      where: { companyId_monthKey_bucket: { companyId, monthKey: MONTH, bucket: 'OCR' } },
    });
    assert.equal(month.costSatang, OCR_BOUND, 'the hold own declared bound, to the satang');
    assert.equal(bucket.costSatang, OCR_BOUND);
    // J-07 on real rows: money without a model call.
    assert.equal(month.callCount, 0);
    assert.equal(bucket.callCount, 0);
    assert.equal(month.inputTokens, 0);
    const events = await client.aiUsageEvent.findMany({ where: { companyId } });
    assert.equal(events.length, 1, 'the invocationKey unique index is what makes this exactly one');
    assert.equal(events[0]!.eventKind, 'COST_ADJUSTMENT');
    assert.equal(events[0]!.usageBasis, 'OPERATOR_CHARGED_AT_BOUND');
    assert.equal(events[0]!.costSatang, OCR_BOUND);
    assert.equal(events[0]!.requestKind, 'IMAGE', 'the D1 metadata pinned on the hold is inherited');
    assert.equal(events[0]!.budgetBucket, 'OCR');
    const row = await client.aiBudgetReservation.findUniqueOrThrow({ where: { id: hold.id } });
    assert.equal(row.status, 'SETTLED');
    assert.equal(row.settledCostSatang, OCR_BOUND);
    assert.equal(row.breach, false, 'a charge at the bound can never open a breach');
    // The reserved credit became SPENT credit: the position moved, it did not double-count.
    const position = await client.$transaction((tx) => readAiBudgetMonthSnapshot(tx, companyId, MONTH));
    assert.equal(position.reserved.OCR, 0);
    assert.equal(position.spent.OCR, OCR_BOUND);
    assert.equal(await client.auditLog.count({ where: { companyId, action: 'ai.credit_hold.charged_at_bound' } }), 1);
  });

  it('J-04: a released hold cannot then be charged, and a charged hold cannot then be released', async (t) => {
    if (unreachable) return t.skip(unreachable);
    const companyId = await company('cross');
    const released = await stranded(companyId, 'CHAT', 'cross-release');
    const charged = await stranded(companyId, 'CHAT', 'cross-charge');

    assert.ok((await releaseAiBudgetHoldByOperator(prisma, decision(companyId, released.id), RELEASE_AUDIT)).ok);
    assert.ok((await chargeAiBudgetHoldAtBound(prisma, decision(companyId, charged.id), CHARGE_AUDIT)).ok);

    assert.deepEqual(await chargeAiBudgetHoldAtBound(prisma, decision(companyId, released.id), CHARGE_AUDIT),
      { ok: false, reason: 'already-resolved' });
    assert.deepEqual(await releaseAiBudgetHoldByOperator(prisma, decision(companyId, charged.id), RELEASE_AUDIT),
      { ok: false, reason: 'already-resolved' });
    // Exactly one money row, from the charge only.
    assert.equal(await client.aiUsageEvent.count({ where: { companyId } }), 1);
    const month = await client.companyAiMonthlyUsage.findUniqueOrThrow({ where: { companyId_monthKey: { companyId, monthKey: MONTH } } });
    assert.equal(month.costSatang, CHAT_BOUND);
  });

  it('J-04: another tenant reservation id is not found, and nothing is written', async (t) => {
    if (unreachable) return t.skip(unreachable);
    const owner = await company('tenant-owner');
    const other = await company('tenant-other');
    const hold = await stranded(owner, 'CHAT', 'tenant-attempt');

    for (const run of [releaseAiBudgetHoldByOperator, chargeAiBudgetHoldAtBound, acknowledgeAiBudgetBreach]) {
      assert.deepEqual(await run(prisma, decision(other, hold.id), RELEASE_AUDIT), { ok: false, reason: 'not-found' });
    }
    const row = await client.aiBudgetReservation.findUniqueOrThrow({ where: { id: hold.id } });
    assert.equal(row.status, 'UNRESOLVED');
    assert.equal(await client.auditLog.count({ where: { companyId: other } }), 0);
  });

  it('J-04: acknowledging a breach reopens admission for that scope and only that scope', async (t) => {
    if (unreachable) return t.skip(unreachable);
    const companyId = await company('breach', { total: 100_000, chat: 50_000, ocr: 50_000 });
    // A real breach: settle an OCR invocation above its own bound.
    const held = await reserve(companyId, 'OCR', 'breach-attempt');
    assert.ok(held.ok);
    await markAiBudgetStepDispatched(prisma, held.reservation.id, held.reservation.ownerToken);
    assert.equal(await settleAiBudgetStep(prisma, {
      invocationKey: held.reservation.invocationKey,
      entry: evidence({ inputTokens: 2_000_000, outputTokens: 2_000_000 }),
      meta: { sourceRoute: 'bank-statement-extract' },
    }), 'settled');
    const breached = await client.aiBudgetReservation.findUniqueOrThrow({ where: { id: held.reservation.id } });
    assert.equal(breached.breach, true, 'the actual really exceeded the bound');

    // Admission for OCR is shut; CHAT is untouched, because the breach is per bucket.
    const shut = await reserve(companyId, 'OCR', 'after-breach');
    assert.equal((shut as { reason: string }).reason, 'unavailable');
    assert.equal((shut as { detail: string }).detail, 'invariant_breach');
    assert.equal((await client.$transaction((tx) => readAiBudgetMonthSnapshot(tx, companyId, MONTH))).breach, true);
    assert.ok((await reserve(companyId, 'CHAT', 'chat-unaffected')).ok, 'the other bucket keeps working');

    const ack = await acknowledgeAiBudgetBreach(prisma, decision(companyId, held.reservation.id), ACK_AUDIT);
    assert.deepEqual(ack, { ok: true, status: 'SETTLED', chargedSatang: 0 });

    // …and OCR is open again, with the recorded money untouched.
    const reopened = await client.aiBudgetReservation.findUniqueOrThrow({ where: { id: held.reservation.id } });
    assert.equal(reopened.breach, true, 'the historical fact is never cleared');
    assert.ok(reopened.breachAcknowledgedAt instanceof Date);
    assert.equal(reopened.breachAcknowledgedByUserId, userId);
    assert.equal(reopened.settledCostSatang, breached.settledCostSatang, 'no money was clamped or refunded');
    assert.equal((await client.$transaction((tx) => readAiBudgetMonthSnapshot(tx, companyId, MONTH))).breach, false);
    assert.ok((await reserve(companyId, 'OCR', 'after-ack')).ok, 'admission for the scope is open again');

    // A repeat is refused, and the acknowledgement is audited exactly once.
    assert.deepEqual(await acknowledgeAiBudgetBreach(prisma, decision(companyId, held.reservation.id), ACK_AUDIT),
      { ok: false, reason: 'already-acknowledged' });
    assert.equal(await client.auditLog.count({ where: { companyId, action: 'ai.credit_breach.acknowledged' } }), 1);
  });

  it('J-04: late evidence after an operator release is still recorded IN FULL as settled-anomaly', async (t) => {
    if (unreachable) return t.skip(unreachable);
    const companyId = await company('late-evidence');
    const hold = await stranded(companyId, 'CHAT', 'late-attempt');
    assert.ok((await releaseAiBudgetHoldByOperator(prisma, decision(companyId, hold.id), RELEASE_AUDIT)).ok);

    // The provider evidence the operator was sure would never arrive.
    const result = await settleAiBudgetStep(prisma, {
      invocationKey: hold.invocationKey, entry: evidence(), meta: { sourceRoute: 'crm-intake' },
    });

    assert.equal(result, 'settled-anomaly', 'a wrong release can never turn real cost into zero');
    const event = await client.aiUsageEvent.findUniqueOrThrow({ where: { invocationKey: hold.invocationKey } });
    assert.ok(event.costSatang > 0, 'the FULL actual is recorded');
    assert.equal(event.eventKind, 'MODEL_CALL', 'real evidence is a real call, unlike an operator charge');
    assert.equal(event.usageBasis, 'PROVIDER_REPORTED');
    const row = await client.aiBudgetReservation.findUniqueOrThrow({ where: { id: hold.id } });
    assert.equal(row.status, 'SETTLED');
    // The anomaly names what the row was, so reconciliation can see the operator's decision.
    assert.equal((row.evidenceJson as { anomaly: { previousStatus: string } }).anomaly.previousStatus, 'CANCELLED');
    const month = await client.companyAiMonthlyUsage.findUniqueOrThrow({ where: { companyId_monthKey: { companyId, monthKey: MONTH } } });
    assert.equal(month.costSatang, event.costSatang);
    assert.equal(month.callCount, 1, 'a real provider call DOES count');
  });

  it('J-04: 40 operator decisions racing live reserves and settles never deadlock', async (t) => {
    if (unreachable) return t.skip(unreachable);
    const companyId = await company('no-deadlock', { total: 1_000_000, chat: 500_000, ocr: 500_000 });
    const errors: string[] = [];

    for (let round = 0; round < 20; round += 1) {
      // One hold to reconcile, one hold to settle with real evidence, plus a fresh reserve — all
      // three taking `ai-budget:<company>:<month>` from different connections at the same time.
      const target = await stranded(companyId, round % 2 === 0 ? 'CHAT' : 'OCR', `race-target-${round}`);
      const live = await reserve(companyId, 'CHAT', `race-live-${round}`);
      assert.ok(live.ok);
      await markAiBudgetStepDispatched(prisma, live.reservation.id, live.reservation.ownerToken);

      const settled = await Promise.allSettled([
        round % 2 === 0
          ? releaseAiBudgetHoldByOperator(prisma, decision(companyId, target.id), RELEASE_AUDIT)
          : chargeAiBudgetHoldAtBound(prisma, decision(companyId, target.id), CHARGE_AUDIT),
        settleAiBudgetStep(prisma, {
          invocationKey: live.reservation.invocationKey, entry: evidence(), meta: { sourceRoute: 'crm-intake' },
        }),
        reserve(companyId, 'OCR', `race-new-${round}`),
      ]);
      for (const outcome of settled) {
        if (outcome.status === 'rejected') errors.push(String((outcome.reason as Error).message).slice(0, 160));
      }
      // Every operator decision must have succeeded: a deadlock victim would report `failed`.
      const first = settled[0]!;
      assert.equal(first.status, 'fulfilled');
      assert.equal((first.value as { ok: boolean }).ok, true, `round ${round}: ${JSON.stringify(first.value)}`);
    }

    // A deadlock surfaces as SQLSTATE 40P01; the engine catches it and would answer `failed`, so
    // the assertion above is the real detector and this is the belt.
    assert.equal(errors.filter((message) => message.includes('40P01') || /deadlock/i.test(message)).length, 0, errors.join(' | '));
    const position = await client.$transaction((tx) => readAiBudgetMonthSnapshot(tx, companyId, MONTH));
    assert.ok(position.spent.CHAT + position.reserved.CHAT <= 500_000, 'CHAT invariant survived the race');
    assert.ok(position.spent.OCR + position.reserved.OCR <= 500_000, 'OCR invariant survived the race');
  });

  it('J-03: the read sweeps first, so a quiet company sees UNRESOLVED instead of DISPATCHED', async (t) => {
    if (unreachable) return t.skip(unreachable);
    const companyId = await company('read-sweep');
    const held = await reserve(companyId, 'OCR', 'read-attempt');
    assert.ok(held.ok);
    await markAiBudgetStepDispatched(prisma, held.reservation.id, held.reservation.ownerToken);
    const old = new Date(Date.now() - AI_BUDGET_DISPATCHED_SWEEP_MS - 60_000);
    await client.aiBudgetReservation.update({ where: { id: held.reservation.id }, data: { createdAt: old, dispatchedAt: old } });

    // Before the sweep the row is DISPATCHED, so it is NOT on the list.
    assert.deepEqual(await listAiBudgetCreditHolds(prisma, companyId, [MONTH]), []);
    assert.equal(await sweepAiBudgetCompanyMonth(prisma, companyId, MONTH), true);
    // Idempotent: running it again changes nothing.
    assert.equal(await sweepAiBudgetCompanyMonth(prisma, companyId, MONTH), true);

    const listed = await listAiBudgetCreditHolds(prisma, companyId, [MONTH]);
    assert.equal(listed.length, 1);
    assert.equal(listed[0]!.kind, 'UNRESOLVED_HOLD');
    assert.equal(listed[0]!.upperBoundSatang, OCR_BOUND);
    assert.equal(listed[0]!.invocationKeyShort.includes(companyId), false, 'the company segment never ships');
  });

  it('J-04: an acknowledged breach leaves the list, a released hold leaves the list', async (t) => {
    if (unreachable) return t.skip(unreachable);
    const companyId = await company('list-shrinks');
    const hold = await stranded(companyId, 'CHAT', 'list-attempt');
    assert.equal((await listAiBudgetCreditHolds(prisma, companyId, [MONTH])).length, 1);

    assert.ok((await releaseAiBudgetHoldByOperator(prisma, decision(companyId, hold.id), RELEASE_AUDIT)).ok);
    assert.deepEqual(await listAiBudgetCreditHolds(prisma, companyId, [MONTH]), []);
  });
});
