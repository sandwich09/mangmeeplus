/**
 * Durable per-invocation money holds for `SPLIT` companies (remediation spec §12.3/§12.6,
 * ADR 0013 §5/§7).
 *
 * Plain functions in the `company-ai-usage-meter.ts` style, in their OWN file on purpose: the meter
 * and the policy resolver already import each other, and this engine must not widen that cycle. It
 * imports the policy resolver, the price map and pure helpers only — never the meter's admission
 * function. The meter calls in; nothing here calls back.
 *
 * Every operation is ONE interactive transaction with no network inside it. FX is resolved by the
 * caller before the transaction opens, and the canonical lock order (spec §12.7) is
 * `partner-ocr-config:<company>` -> `platform-ai-budget` -> `ai-budget:<company>:<pinned month>`,
 * with bucket rows touched CHAT before OCR.
 */
import { createHash, randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import {
  aiBudgetInvocationKey,
  aiBudgetStepBounds,
  type AiBudgetEnvelope,
  type AiBudgetScope,
  type AiUsageEntry,
} from '@watchdog-bms/contracts';
import type { AppConfigService } from '../../../common/config/app-config.service';
import type { PrismaService } from '../../../common/database/prisma.service';
import { SECURITY_EVENT, emitSecurityEvent } from '../../../common/logger/security-event';
import { buildPricingSnapshot, computeCostSatang, priceAiStepUpperBound } from './ai-model-pricing';
import { resolveAiBudgetPolicy, type CompanyAiBudgetPolicyRow } from './company-ai-budget-policy';
import { isMeterableEntry, normalizeUsageBasis, type AiBudgetBucket, type AiRequestKind } from './company-ai-usage-meter';

const logger = new Logger('CompanyAiBudgetReservation');

/** Holds that still owe the company money — the exact set `reserved` sums over. */
const LIVE_STATUSES = ['RESERVED', 'DISPATCHED', 'UNRESOLVED'] as const;
/** Bucket rows are always touched in this order, so two settlements cannot deadlock on them. */
const BUCKET_ORDER: readonly AiBudgetBucket[] = ['CHAT', 'OCR'];

/**
 * `RESERVED` older than this proves no provider call started: the `DISPATCHED` mark is written and
 * committed BEFORE every provider call, and the gap between the two is one in-process statement.
 * Ten minutes is orders of magnitude longer than that gap and shorter than any human notices.
 */
export const AI_BUDGET_RESERVED_SWEEP_MS = 10 * 60 * 1_000;
/**
 * `DISPATCHED` older than this becomes `UNRESOLVED` — still counted as reserved, never released.
 * Strictly greater than the longest caller timeout (receipt OCR at 195s, LINE turn at 120s, the
 * admission lease at 180s) plus a wide margin, so a slow-but-alive call is never mislabelled.
 */
export const AI_BUDGET_DISPATCHED_SWEEP_MS = 30 * 60 * 1_000;

/** The single-row platform settings id, mirrored from the meter (spec §7.3). */
const PLATFORM_CONFIG_ID = 'platform';

/**
 * An attempt key is stored, indexed and shipped to the gateway, so a natural id that is PERSONAL
 * DATA — every LINE message/webhook/user id is — goes through here first (spec §12.4: no prompt
 * text, raw LINE id or secret in an execution identity). Truncated SHA-256: not reversible, and
 * 128 bits is far past any collision risk inside one company-month.
 */
export function aiBudgetAttemptHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 32);
}

export type AiBudgetCancelProof =
  /** The OCR count/switch/plan gate refused AFTER the hold and BEFORE any HTTP call. */
  | 'ocr_admission_refused'
  /** The gateway answered one of the exact pre-provider refusal shapes (`isOcrPreProviderRefusal`). */
  | 'gateway_pre_provider_refusal'
  /** The lazy sweep: a `RESERVED` row that was never dispatched. */
  | 'never_dispatched';

export type ReservedAiBudgetStep = {
  id: string;
  companyId: string;
  monthKey: string;
  bucket: AiBudgetBucket;
  stepKind: string;
  attemptKey: string;
  invocationKey: string;
  ordinal: number;
  upperBoundSatang: number;
  ownerToken: string;
  envelope: AiBudgetEnvelope;
};

export type AiBudgetReserveOutcome =
  | { ok: true; reservation: ReservedAiBudgetStep }
  | { ok: false; reason: 'exceeded'; budgetScope: AiBudgetScope; spendSatang: number; capSatang: number; override: boolean }
  | { ok: false; reason: 'insufficient'; budgetScope: AiBudgetScope; spendSatang: number; reservedSatang: number; capSatang: number }
  | { ok: false; reason: 'unavailable'; budgetScope: AiBudgetScope; detail: string }
  /** R-03: this invocation is already owned. NEVER a second execution of the provider. */
  | { ok: false; reason: 'already_claimed'; status: string; reservationId: string };

export type ReserveAiBudgetStepInput = {
  companyId: string;
  /** PINNED by the caller. Everything below reads and writes THIS month, never the clock's. */
  monthKey: string;
  bucket: AiBudgetBucket;
  stepKind: string;
  attemptKey: string;
  /** Bounded call index inside the step kind; `0` for the first invocation of an attempt. */
  ordinal: number;
  sourceRoute: string;
  modelId: string;
  /** Resolved OUTSIDE the transaction — `resolveThbPerUsd` may make an outbound call. */
  thbPerUsd: number;
  thbPerUsdSource: string;
  now?: Date;
};

/** Reads `CompanyAiConfiguration` + the platform row FRESH under the locks (never the meter cache). */
async function resolveBudgetUnderLock(
  tx: any,
  config: AppConfigService,
  companyId: string,
  monthKey: string,
) {
  const row = (await tx.companyAiConfiguration.findUnique({
    where: { companyId },
    select: {
      monthlyBudgetSatang: true, budgetMode: true, chatMonthlyBudgetSatang: true,
      ocrMonthlyBudgetSatang: true, budgetConfigVersion: true, pendingBudgetPolicy: true,
    },
  })) as ({ monthlyBudgetSatang: number | null } & CompanyAiBudgetPolicyRow) | null;
  const override = row?.monthlyBudgetSatang != null;
  const platform = override ? null : await tx.platformAiBudgetConfig.findUnique({
    where: { id: PLATFORM_CONFIG_ID }, select: { monthlyBudgetSatang: true },
  });
  const totalSatang = override ? row!.monthlyBudgetSatang! : platform?.monthlyBudgetSatang ?? config.aiMonthlyBudgetSatang;
  return { totalSatang, override, policy: resolveAiBudgetPolicy({ row, totalSatang, override, monthKey }) };
}

/** Sums the live holds of a company-month, and of one bucket inside it, under the held lock. */
async function liveReserved(tx: any, companyId: string, monthKey: string, bucket: AiBudgetBucket) {
  const rows = await tx.aiBudgetReservation.groupBy({
    by: ['bucket'],
    where: { companyId, monthKey, status: { in: [...LIVE_STATUSES] } },
    _sum: { upperBoundSatang: true },
  });
  const total = rows.reduce((sum: number, r: any) => sum + (r._sum.upperBoundSatang ?? 0), 0);
  return { total, bucket: rows.find((r: any) => r.bucket === bucket)?._sum.upperBoundSatang ?? 0 };
}

/** Month-to-date SPEND of the company (all buckets) and of one bucket, from the aggregates. */
async function liveSpend(tx: any, companyId: string, monthKey: string, bucket: AiBudgetBucket) {
  const month = await tx.companyAiMonthlyUsage.findUnique({
    where: { companyId_monthKey: { companyId, monthKey } }, select: { costSatang: true },
  });
  const bucketRow = await tx.companyAiMonthlyBucketUsage.findUnique({
    where: { companyId_monthKey_bucket: { companyId, monthKey, bucket } }, select: { costSatang: true },
  });
  return { total: month?.costSatang ?? 0, bucket: bucketRow?.costSatang ?? 0 };
}

/**
 * The admission comparison of ADR 0013 §5, as a pure function so the whole decision table is
 * testable without a database.
 *
 * TOTAL is checked before the bucket, because the total is the ceiling neither bucket may cross;
 * and inside each scope `exceeded` (the cap is REACHED — nothing more runs this month) is separate
 * from `insufficient` (money is left, just not this step's bound). A cap of 0 therefore closes its
 * bucket through `exceeded` at spend 0, which is exactly "this bucket is not allowed".
 */
export function decideAiBudgetStep(input: {
  bucket: AiBudgetBucket;
  boundSatang: number;
  totalSatang: number;
  capSatang: number;
  spent: { total: number; bucket: number };
  reserved: { total: number; bucket: number };
  override: boolean;
}): Exclude<AiBudgetReserveOutcome, { ok: true } | { reason: 'already_claimed' }> | { ok: true } {
  const { boundSatang: bound, spent, reserved } = input;
  if (spent.total >= input.totalSatang) {
    return { ok: false, reason: 'exceeded', budgetScope: 'TOTAL',
      spendSatang: spent.total, capSatang: input.totalSatang, override: input.override };
  }
  if (spent.total + reserved.total + bound > input.totalSatang) {
    return { ok: false, reason: 'insufficient', budgetScope: 'TOTAL',
      spendSatang: spent.total, reservedSatang: reserved.total, capSatang: input.totalSatang };
  }
  if (spent.bucket >= input.capSatang) {
    return { ok: false, reason: 'exceeded', budgetScope: input.bucket,
      spendSatang: spent.bucket, capSatang: input.capSatang, override: input.override };
  }
  if (spent.bucket + reserved.bucket + bound > input.capSatang) {
    return { ok: false, reason: 'insufficient', budgetScope: input.bucket,
      spendSatang: spent.bucket, reservedSatang: reserved.bucket, capSatang: input.capSatang };
  }
  return { ok: true };
}

/**
 * The lazy sweep (ADR 0013 §6) — no cron, no worker. It runs inside the reserve transaction for
 * THIS company-month only, before the sums, so a crashed owner's holds are resolved by the next
 * call that needs the money rather than by a timer that could free a live one.
 */
async function sweepCompanyMonth(tx: any, companyId: string, monthKey: string, now: Date): Promise<void> {
  await tx.aiBudgetReservation.updateMany({
    where: { companyId, monthKey, status: 'RESERVED', createdAt: { lt: new Date(now.getTime() - AI_BUDGET_RESERVED_SWEEP_MS) } },
    data: { status: 'CANCELLED', evidenceJson: { proof: 'never_dispatched' as AiBudgetCancelProof, sweptAt: now.toISOString() } },
  });
  // NOT released: an UNRESOLVED hold keeps counting until evidence or an audited operator decision
  // closes it. Money is never handed back on a timer (spec §12.3).
  await tx.aiBudgetReservation.updateMany({
    where: { companyId, monthKey, status: 'DISPATCHED', dispatchedAt: { lt: new Date(now.getTime() - AI_BUDGET_DISPATCHED_SWEEP_MS) } },
    data: { status: 'UNRESOLVED' },
  });
}

/**
 * Admits ONE provider invocation, or refuses it with the scope that actually blocked (ADR 0013 §5).
 *
 * TOTAL is checked before the bucket, and within each scope `exceeded` (the cap is reached) is
 * distinguished from `insufficient` (money is left, but not this step's bound) — the customer copy
 * must never say "เต็ม" for the second one.
 */
export async function reserveAiBudgetStep(
  prisma: PrismaService,
  config: AppConfigService,
  input: ReserveAiBudgetStepInput,
): Promise<AiBudgetReserveOutcome> {
  const bounds = aiBudgetStepBounds(input.stepKind);
  // A seam whose bound nobody declared can never be reserved — the ADR 0013 §9 readiness property.
  if (!bounds) return { ok: false, reason: 'unavailable', budgetScope: 'TOTAL', detail: 'step_bound_missing' };
  if (input.ordinal < 0 || input.ordinal >= bounds.maxCalls) {
    return { ok: false, reason: 'unavailable', budgetScope: 'TOTAL', detail: 'step_call_budget_exhausted' };
  }
  if (!BUCKET_ORDER.includes(input.bucket)) {
    return { ok: false, reason: 'unavailable', budgetScope: 'TOTAL', detail: 'bucket_unknown' };
  }
  if (!input.modelId) return { ok: false, reason: 'unavailable', budgetScope: 'TOTAL', detail: 'model_unknown' };
  const priced = priceAiStepUpperBound(input.stepKind, input.modelId, input.thbPerUsd);
  if (!priced) return { ok: false, reason: 'unavailable', budgetScope: 'TOTAL', detail: 'price_unavailable' };

  const now = input.now ?? new Date();
  const invocationKey = aiBudgetInvocationKey(input.companyId, input.attemptKey, input.stepKind, input.ordinal);
  const ownerToken = randomUUID();

  try {
    return await prisma.client.$transaction(async (tx: any) => {
      // Canonical lock order (spec §12.7). The config lock is shared with the admin writer, so a
      // cap change and an admission can never pass each other reading different policy states.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`partner-ocr-config:${input.companyId}`}))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'platform-ai-budget'}))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ai-budget:${input.companyId}:${input.monthKey}`}))`;

      // R-03: the execution fence comes FIRST. A redelivered webhook must never buy a second hold.
      const claimed = await tx.aiBudgetReservation.findUnique({
        where: { invocationKey }, select: { id: true, status: true },
      });
      if (claimed) return { ok: false as const, reason: 'already_claimed' as const, status: claimed.status, reservationId: claimed.id };

      const { policy } = await resolveBudgetUnderLock(tx, config, input.companyId, input.monthKey);
      if (policy.invalidReason) {
        return { ok: false as const, reason: 'unavailable' as const, budgetScope: 'TOTAL' as AiBudgetScope, detail: policy.invalidReason };
      }
      if (policy.mode !== 'SPLIT') {
        return { ok: false as const, reason: 'unavailable' as const, budgetScope: 'TOTAL' as AiBudgetScope, detail: 'policy_not_split' };
      }
      const capSatang = input.bucket === 'CHAT' ? policy.chatCapSatang : policy.ocrCapSatang;
      if (capSatang === null) {
        return { ok: false as const, reason: 'unavailable' as const, budgetScope: input.bucket as AiBudgetScope, detail: 'bucket_cap_missing' };
      }

      await sweepCompanyMonth(tx, input.companyId, input.monthKey, now);

      // An actual above its bound closed this scope (spec §12.3). Nothing else may start here
      // until an operator clears the flag; the money already recorded is never clamped.
      const breached = await tx.aiBudgetReservation.count({
        where: { companyId: input.companyId, monthKey: input.monthKey, bucket: input.bucket, breach: true },
      });
      if (breached > 0) {
        return { ok: false as const, reason: 'unavailable' as const, budgetScope: input.bucket as AiBudgetScope, detail: 'invariant_breach' };
      }

      const spend = await liveSpend(tx, input.companyId, input.monthKey, input.bucket);
      const reserved = await liveReserved(tx, input.companyId, input.monthKey, input.bucket);
      const bound = priced.upperBoundSatang;

      const decision = decideAiBudgetStep({
        bucket: input.bucket, boundSatang: bound, totalSatang: policy.totalSatang, capSatang,
        spent: spend, reserved, override: policy.override,
      });
      if (!decision.ok) return decision;

      const created = await tx.aiBudgetReservation.create({
        data: {
          companyId: input.companyId, monthKey: input.monthKey, bucket: input.bucket,
          policyRevision: policy.revision, sourceRoute: input.sourceRoute, stepKind: input.stepKind,
          attemptKey: input.attemptKey, invocationKey, upperBoundSatang: bound,
          pricingSnapshot: { ...priced.snapshot, thbPerUsdSource: input.thbPerUsdSource },
          status: 'RESERVED', ownerToken,
        },
        select: { id: true },
      });
      return {
        ok: true as const,
        reservation: {
          id: created.id, companyId: input.companyId, monthKey: input.monthKey, bucket: input.bucket,
          stepKind: input.stepKind, attemptKey: input.attemptKey, invocationKey, ordinal: input.ordinal,
          upperBoundSatang: bound, ownerToken,
          envelope: {
            attemptKey: input.attemptKey, stepKind: input.stepKind as AiBudgetEnvelope['stepKind'],
            invocationKey, bucket: input.bucket, monthKey: input.monthKey, modelId: input.modelId,
            bounds, maxCalls: bounds.maxCalls,
          },
        },
      };
    });
  } catch (err) {
    // Ids and counters only: this runs on the money path and must never log a prompt or a cap.
    logger.warn({ msg: 'ai.budget.reserve_failed', companyId: input.companyId, monthKey: input.monthKey,
      stepKind: input.stepKind, error: (err as Error).message });
    return { ok: false, reason: 'unavailable', budgetScope: 'TOTAL', detail: 'reserve_failed' };
  }
}

/**
 * `RESERVED -> DISPATCHED`, fenced on the owner token. This mark is durably committed BEFORE the
 * seam performs its HTTP call, which is exactly what makes a stale `RESERVED` row provable evidence
 * that no provider ever started.
 */
export async function markAiBudgetStepDispatched(
  prisma: PrismaService,
  reservationId: string,
  ownerToken: string,
): Promise<boolean> {
  try {
    const { count } = await prisma.client.aiBudgetReservation.updateMany({
      where: { id: reservationId, ownerToken, status: 'RESERVED' },
      data: { status: 'DISPATCHED', dispatchedAt: new Date() },
    });
    return count === 1;
  } catch (err) {
    logger.warn({ msg: 'ai.budget.dispatch_failed', reservationId, error: (err as Error).message });
    return false;
  }
}

/**
 * Releases a hold, and ONLY with proof that no provider call started (spec §12.3, R-05).
 *
 * `RESERVED` is self-proving. `DISPATCHED` needs the seam's explicit proof — the OCR count/switch/
 * plan gate refusing before the HTTP call, or the gateway answering one of the exact pre-provider
 * refusal shapes. Refunding an OCR COUNT after a provider FAILURE is not such a proof and cannot
 * reach this function: `releaseCompanyOcrAdmission` neither takes a reservation nor a proof.
 *
 * A wrong `ownerToken` is a silent no-op — a stale owner's delayed compensation must never release
 * the hold a new owner is relying on.
 */
export async function cancelAiBudgetStep(
  prisma: PrismaService,
  input: { reservationId: string; ownerToken: string; proof: AiBudgetCancelProof },
): Promise<boolean> {
  try {
    const row = await prisma.client.aiBudgetReservation.findUnique({
      where: { id: input.reservationId }, select: { companyId: true, monthKey: true },
    });
    if (!row) return false;
    return await prisma.client.$transaction(async (tx: any) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ai-budget:${row.companyId}:${row.monthKey}`}))`;
      const { count } = await tx.aiBudgetReservation.updateMany({
        where: {
          id: input.reservationId, ownerToken: input.ownerToken,
          status: input.proof === 'never_dispatched' ? 'RESERVED' : { in: ['RESERVED', 'DISPATCHED'] },
        },
        data: { status: 'CANCELLED', evidenceJson: { proof: input.proof, cancelledAt: new Date().toISOString() } },
      });
      return count === 1;
    });
  } catch (err) {
    logger.warn({ msg: 'ai.budget.cancel_failed', reservationId: input.reservationId, error: (err as Error).message });
    return false;
  }
}

export type SettleAiBudgetStepResult =
  | 'settled'
  /** An event already carries this invocation key — the fence held, nothing was billed twice. */
  | 'duplicate'
  | 'unknown-invocation'
  /** Evidence arrived for a hold that was never marked dispatched, or was already cancelled. */
  | 'invalid-state'
  /** The counters were not non-negative safe integers: nothing settles and the hold stays. */
  | 'invalid-evidence'
  | 'failed';

export type SettleAiBudgetStepInput = {
  invocationKey: string;
  entry: AiUsageEntry;
  meta: { sourceRoute: string; requestId?: string; requestKind?: AiRequestKind };
  now?: Date;
};

/**
 * Turns invocation evidence into the ledger, exactly once (ADR 0013 §7).
 *
 * The `AiUsageEvent` row, the month aggregate, the bucket aggregate and the reservation's terminal
 * state all move in ONE transaction fenced by `AiUsageEvent.invocationKey`, so a replayed
 * settlement — the gateway retrying, or the usage riding back on the HTTP response as well — is a
 * no-op instead of a second charge.
 *
 * Money is priced at the FX and prices PINNED on the reservation, never at today's rate: the hold
 * and the settlement have to be comparable, and history is never re-priced.
 */
export async function settleAiBudgetStep(
  prisma: PrismaService,
  input: SettleAiBudgetStepInput,
): Promise<SettleAiBudgetStepResult> {
  // The trust boundary is the same one `recordCompanyAiUsage` applies: wire JSON whose counters are
  // not non-negative safe integers must never reach pricing or an aggregate.
  if (!isMeterableEntry(input.entry)) return 'invalid-evidence';
  const now = input.now ?? new Date();
  let breach: { companyId: string; monthKey: string; bucket: string; reservationId: string; boundSatang: number; actualSatang: number } | undefined;
  try {
    const result = await prisma.client.$transaction(async (tx: any) => {
      const reservation = await tx.aiBudgetReservation.findUnique({ where: { invocationKey: input.invocationKey } });
      if (!reservation) return 'unknown-invocation' as const;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ai-budget:${reservation.companyId}:${reservation.monthKey}`}))`;

      const already = await tx.aiUsageEvent.findUnique({ where: { invocationKey: input.invocationKey }, select: { id: true } });
      if (already) return 'duplicate' as const;
      // Late evidence for an UNRESOLVED hold is exactly what closes it; a RESERVED row was never
      // dispatched and a CANCELLED/SETTLED one is terminal.
      if (reservation.status !== 'DISPATCHED' && reservation.status !== 'UNRESOLVED') return 'invalid-state' as const;

      const snapshot = (reservation.pricingSnapshot ?? {}) as { thbPerUsd?: unknown; thbPerUsdSource?: unknown };
      const thbPerUsd = Number(snapshot.thbPerUsd);
      if (!Number.isFinite(thbPerUsd) || thbPerUsd <= 0) return 'invalid-state' as const;
      const { costSatang } = computeCostSatang(input.entry, thbPerUsd);

      await tx.aiUsageEvent.create({
        data: {
          companyId: reservation.companyId, monthKey: reservation.monthKey,
          sourceRoute: input.meta.sourceRoute, usageTag: input.entry.tag, modelId: input.entry.modelId,
          ok: input.entry.ok, inputTokens: input.entry.inputTokens, outputTokens: input.entry.outputTokens,
          cacheReadInputTokens: input.entry.cacheReadInputTokens, cacheWriteInputTokens: input.entry.cacheWriteInputTokens,
          costSatang, thbPerUsd, thbPerUsdSource: String(snapshot.thbPerUsdSource ?? 'reservation'),
          requestId: input.meta.requestId, requestKind: input.meta.requestKind ?? null,
          budgetBucket: reservation.bucket,
          usageBasis: normalizeUsageBasis((input.entry as { usageBasis?: unknown }).usageBasis),
          eventKind: 'MODEL_CALL', pricingSnapshot: buildPricingSnapshot(input.entry, thbPerUsd, costSatang),
          invocationKey: input.invocationKey,
        },
      });
      const delta = {
        costSatang, inputTokens: input.entry.inputTokens, outputTokens: input.entry.outputTokens,
        cacheReadInputTokens: input.entry.cacheReadInputTokens, cacheWriteInputTokens: input.entry.cacheWriteInputTokens,
      };
      // The PINNED month, never the clock's: a chain that crosses Bangkok midnight still lands here.
      await tx.companyAiMonthlyUsage.upsert({
        where: { companyId_monthKey: { companyId: reservation.companyId, monthKey: reservation.monthKey } },
        create: { companyId: reservation.companyId, monthKey: reservation.monthKey, callCount: 1, ...delta },
        update: {
          costSatang: { increment: delta.costSatang }, callCount: { increment: 1 },
          inputTokens: { increment: delta.inputTokens }, outputTokens: { increment: delta.outputTokens },
          cacheReadInputTokens: { increment: delta.cacheReadInputTokens },
          cacheWriteInputTokens: { increment: delta.cacheWriteInputTokens },
        },
      });
      await upsertBucketUsage(tx, reservation.companyId, reservation.monthKey, reservation.bucket, costSatang, 1);

      // No clamp, ever. The FULL actual is already recorded above; this only closes the scope.
      const breached = costSatang > reservation.upperBoundSatang;
      await tx.aiBudgetReservation.update({
        where: { id: reservation.id },
        data: {
          status: 'SETTLED', settledCostSatang: costSatang, settledAt: now, breach: breached,
          usageBasis: normalizeUsageBasis((input.entry as { usageBasis?: unknown }).usageBasis),
          evidenceJson: { tag: input.entry.tag, modelId: input.entry.modelId, ok: input.entry.ok,
            inputTokens: input.entry.inputTokens, outputTokens: input.entry.outputTokens,
            cacheReadInputTokens: input.entry.cacheReadInputTokens, cacheWriteInputTokens: input.entry.cacheWriteInputTokens },
        },
      });
      if (breached) {
        breach = { companyId: reservation.companyId, monthKey: reservation.monthKey, bucket: reservation.bucket,
          reservationId: reservation.id, boundSatang: reservation.upperBoundSatang, actualSatang: costSatang };
      }
      return 'settled' as const;
    });
    // Post-commit, the `admitCompanyOcr` precedent: an observability write must never abort a
    // settlement that already holds the money truthfully.
    if (breach) emitSecurityEvent(logger, SECURITY_EVENT.aiCompanyBudgetExceeded, 'HIGH', { ...breach, invariant: 'actual_above_reserved_bound' });
    return result;
  } catch (err) {
    logger.warn({ msg: 'ai.budget.settle_failed', invocationKey: input.invocationKey, error: (err as Error).message });
    return 'failed';
  }
}

/**
 * The bucket slice of the month aggregate. Exported so `recordCompanyAiUsage` can keep SHARED rows
 * in the SAME aggregate inside its own transaction — one number the console, the admin writer and
 * a later SPLIT activation all read, instead of three different scans of the event table.
 */
export async function upsertBucketUsage(
  tx: any,
  companyId: string,
  monthKey: string,
  bucket: string,
  costSatang: number,
  callCount: number,
): Promise<void> {
  // Tolerant delegate, the `resolveEffectiveBudget` / `resolveCompanyAiModelPolicy` precedent:
  // unit-test fakes that predate this table omit it, and the generated production client always
  // exposes it. Safe to skip, because this row is DERIVED — the authoritative money is the
  // `AiUsageEvent` rows and the month total written in the same transaction.
  if (!tx.companyAiMonthlyBucketUsage) return;
  await tx.companyAiMonthlyBucketUsage.upsert({
    where: { companyId_monthKey_bucket: { companyId, monthKey, bucket } },
    create: { companyId, monthKey, bucket, costSatang, callCount },
    update: { costSatang: { increment: costSatang }, callCount: { increment: callCount } },
  });
}

/** Buckets in the canonical CHAT-then-OCR order, so two writers cannot deadlock on the rows. */
export const aiBudgetBucketOrder = (): readonly AiBudgetBucket[] => BUCKET_ORDER;

/** What the admin read and the E1a writer need: spend, live holds and the breach flag per bucket. */
export type AiBudgetMonthSnapshot = {
  spent: { TOTAL: number; CHAT: number; OCR: number };
  reserved: { TOTAL: number; CHAT: number; OCR: number };
  unresolvedHolds: number;
  breach: boolean;
};

/**
 * One read of everything the console and the cap validator need. Takes a transaction client so the
 * caller decides the snapshot (the admin read uses its RepeatableRead one; the writer uses its
 * locked one) — it never opens a transaction of its own.
 */
export async function readAiBudgetMonthSnapshot(
  tx: any,
  companyId: string,
  monthKey: string,
): Promise<AiBudgetMonthSnapshot> {
  // Same tolerance as `upsertBucketUsage`: a fake that predates these tables reports an empty
  // position rather than throwing. Production always has both delegates.
  if (!tx.companyAiMonthlyBucketUsage || !tx.aiBudgetReservation) {
    const total = typeof tx.companyAiMonthlyUsage?.findUnique === 'function'
      ? await tx.companyAiMonthlyUsage.findUnique({
        where: { companyId_monthKey: { companyId, monthKey } }, select: { costSatang: true },
      })
      : null;
    return {
      spent: { TOTAL: total?.costSatang ?? 0, CHAT: 0, OCR: 0 },
      reserved: { TOTAL: 0, CHAT: 0, OCR: 0 }, unresolvedHolds: 0, breach: false,
    };
  }
  const month = await tx.companyAiMonthlyUsage.findUnique({
    where: { companyId_monthKey: { companyId, monthKey } }, select: { costSatang: true },
  });
  const buckets = await tx.companyAiMonthlyBucketUsage.findMany({
    where: { companyId, monthKey }, select: { bucket: true, costSatang: true },
  });
  const holds = await tx.aiBudgetReservation.groupBy({
    by: ['bucket', 'status'],
    where: { companyId, monthKey, status: { in: [...LIVE_STATUSES] } },
    _sum: { upperBoundSatang: true },
    _count: { _all: true },
  });
  const breached = await tx.aiBudgetReservation.count({ where: { companyId, monthKey, breach: true } });
  const spentOf = (bucket: string) => buckets.find((b: any) => b.bucket === bucket)?.costSatang ?? 0;
  const heldOf = (bucket: string) => holds.filter((h: any) => h.bucket === bucket)
    .reduce((sum: number, h: any) => sum + (h._sum.upperBoundSatang ?? 0), 0);
  return {
    spent: { TOTAL: month?.costSatang ?? 0, CHAT: spentOf('CHAT'), OCR: spentOf('OCR') },
    reserved: { TOTAL: heldOf('CHAT') + heldOf('OCR'), CHAT: heldOf('CHAT'), OCR: heldOf('OCR') },
    unresolvedHolds: holds.filter((h: any) => h.status === 'UNRESOLVED')
      .reduce((sum: number, h: any) => sum + (h._count?._all ?? 0), 0),
    breach: breached > 0,
  };
}
