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
  isAiBudgetRefusalCode,
  type AiBudgetEnvelope,
  type AiBudgetScope,
  type AiUsageEntry,
} from '@watchdog-bms/contracts';
import type { AppConfigService } from '../../../common/config/app-config.service';
import type { PrismaService } from '../../../common/database/prisma.service';
import { SECURITY_EVENT, emitSecurityEvent } from '../../../common/logger/security-event';
import { buildPricingSnapshot, computeCostSatang, priceAiStepUpperBound, computePinnedAiCostV2, type AiRenderedPricingSnapshotV2 } from './ai-model-pricing';
import { aiCreditCycleAllowance, resolveAiBudgetPolicy, type CompanyAiBudgetPolicyRow } from './company-ai-budget-policy';
import { consumeAiCreditHold, readAiCreditBalance, planAiCreditFunding, writeAiCreditHold, type AiCreditFunding, type AiCreditRefusalCause } from './ai-credit-ledger';
import { isMeterableEntry, normalizeUsageBasis, type AiBudgetBucket, type AiRequestKind } from './company-ai-usage-meter';

const logger = new Logger('CompanyAiBudgetReservation');

/** Holds that still owe the company money — the exact set `reserved` sums over. */
const LIVE_STATUSES = ['RESERVED', 'DISPATCHED', 'UNRESOLVED'] as const;
/**
 * Historical overrun alerts awaiting operator acknowledgement. Owner 2026-10-19 removed the
 * admission lock: this predicate is only for the operator snapshot/list, never admission.
 */
const UNACKNOWLEDGED_BREACH = { breach: true, breachAcknowledgedAt: null } as const;
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
  | 'never_dispatched'
  /**
   * A System Admin decided an `UNRESOLVED` hold was never spent (hold spec §4.2). The ONLY proof
   * that is a human decision rather than machine evidence: it carries the actor and the reason, it
   * is fenced on `status = 'UNRESOLVED'` instead of the owner token (the owner is gone — that is
   * why the hold is stranded), and late evidence still lands in FULL through `settled-anomaly`.
   */
  | 'operator_released';

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

/**
 * `aiCredit` (add-on spec §5.3, plan PR C3): set only when a cut-over company's AI credit, not a
 * money cap, refused the call. In-process only — the gateway still gets the existing code and
 * `budgetScope: 'CHAT'`, so no refusal code is added (F-15); the API composes the customer text.
 */
export type AiBudgetReserveOutcome =
  | { ok: true; reservation: ReservedAiBudgetStep }
  | { ok: false; reason: 'exceeded'; budgetScope: AiBudgetScope; spendSatang: number; capSatang: number; override: boolean; aiCredit?: AiCreditRefusalCause }
  | { ok: false; reason: 'insufficient'; budgetScope: AiBudgetScope; spendSatang: number; reservedSatang: number; capSatang: number; aiCredit?: AiCreditRefusalCause }
  | { ok: false; reason: 'unavailable'; budgetScope: AiBudgetScope; detail: string; aiCredit?: AiCreditRefusalCause }
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
  /** Server-derived at admission (`classifyAiUsageRequest`). Pinned on the hold so a settlement
   *  posted by the gateway — which has no business knowing it — still lands with the right D1
   *  metadata instead of UNKNOWN, which would make the month read "partial coverage" forever. */
  requestKind?: AiRequestKind;
  /** Owner 2026-09-30: work the system accepted before the credit ran out (see
   *  `CompanyAiBudgetStep.admitOverCap`). Only the cap decision (`decideAiBudgetStep`) yields, never
   *  for a cap of 0; the hold is written, marked and settled like any other. */
  admitOverCap?: boolean;
  /** Resolved OUTSIDE the transaction — `resolveThbPerUsd` may make an outbound call. */
  thbPerUsd: number;
  thbPerUsdSource: string;
  now?: Date;
};

/**
 * Reads `CompanyAiConfiguration` and, only when it matters, the platform row — FRESH under the
 * locks, never the meter's cache.
 *
 * `platform-ai-budget` is a PLATFORM-WIDE advisory lock: taking it on every reservation of every
 * SPLIT company would serialise unrelated tenants behind one another. It is only needed when this
 * company INHERITS the default, because then the platform writer can move its effective total. A
 * company with its own `monthlyBudgetSatang` override cannot be affected by that writer at all, so
 * it skips the lock. Either way the canonical order holds: config -> (platform) -> ai-budget.
 */
async function resolveBudgetUnderLock(
  tx: any,
  config: AppConfigService,
  companyId: string,
  monthKey: string,
  lockPlatform = true,
  at?: Date,
) {
  const row = (await tx.companyAiConfiguration.findUnique({
    where: { companyId },
    select: {
      monthlyBudgetSatang: true, budgetMode: true, chatMonthlyBudgetSatang: true,
      ocrMonthlyBudgetSatang: true, budgetConfigVersion: true, pendingBudgetPolicy: true,
      salesDealChatCreditSatang: true, salesDealChatCreditEndsAt: true, aiCreditCutoverAt: true,
    },
  })) as ({ monthlyBudgetSatang: number | null; aiCreditCutoverAt?: Date | null } & CompanyAiBudgetPolicyRow) | null;
  const override = row?.monthlyBudgetSatang != null;
  let platform: { monthlyBudgetSatang: number } | null = null;
  if (!override) {
    if (lockPlatform) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'platform-ai-budget'}))`;
    platform = await tx.platformAiBudgetConfig.findUnique({
      where: { id: PLATFORM_CONFIG_ID }, select: { monthlyBudgetSatang: true },
    });
  }
  const totalSatang = override ? row!.monthlyBudgetSatang! : platform?.monthlyBudgetSatang ?? config.aiMonthlyBudgetSatang;
  return { totalSatang, override, row, cutoverAt: row?.aiCreditCutoverAt ?? null,
    policy: resolveAiBudgetPolicy({ row, totalSatang, override, monthKey, at }) };
}

/** A funded call the lots could not cover. Credit refusals carry no money figures: nothing reads them. */
function aiCreditRefusal(funded: Extract<AiCreditFunding, { ok: false }>): AiBudgetReserveOutcome {
  if (funded.cause === 'PACKAGE_REQUIRED') {
    return { ok: false, reason: 'unavailable', budgetScope: 'CHAT', detail: 'ai_credit_package_required', aiCredit: funded.cause };
  }
  return funded.cause === 'EXHAUSTED'
    ? { ok: false, reason: 'exceeded', budgetScope: 'CHAT', spendSatang: 0, capSatang: 0, override: false, aiCredit: funded.cause }
    : { ok: false, reason: 'insufficient', budgetScope: 'CHAT', spendSatang: 0, reservedSatang: 0, capSatang: funded.availableUnits, aiCredit: funded.cause };
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
 *
 * Exported through {@link sweepAiBudgetCompanyMonth} because the operator's reconciliation read has
 * to run the SAME sweep before listing (hold spec §2): a company with no new traffic would
 * otherwise show `DISPATCHED` rows that admission has already decided are `UNRESOLVED`. Idempotent
 * — it only moves rows whose own timestamps are already past the thresholds.
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
 * Runs the admission sweep for one company-month from OUTSIDE a reserve, under the same
 * `ai-budget:<company>:<month>` lock and in the same canonical order (it takes only the last lock,
 * exactly as `settle` and `cancel` do). Idempotent and safe to call before every operator read.
 *
 * Never throws: a sweep that could not run leaves the list showing `DISPATCHED` rows, which is a
 * stale read, not a wrong decision — and refusing the whole page would be worse.
 */
export async function sweepAiBudgetCompanyMonth(
  prisma: PrismaService,
  companyId: string,
  monthKey: string,
  now = new Date(),
): Promise<boolean> {
  try {
    await prisma.client.$transaction(async (tx: any) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ai-budget:${companyId}:${monthKey}`}))`;
      await sweepCompanyMonth(tx, companyId, monthKey, now);
    });
    return true;
  } catch (err) {
    logger.warn({ msg: 'ai.budget.sweep_failed', companyId, monthKey, error: (err as Error).message });
    return false;
  }
}

/** In-process only: authorization and the ordinal CAS happen inside the existing money transaction.
 * This callback is supplied by the API issuer, never read from an HTTP body. */
export type RenderedAiReservationAuthority = {
  upperBoundSatang: number;
  snapshot: AiRenderedPricingSnapshotV2 & Record<string, unknown>;
  /** Absolute ordinal ceiling of the turn: its answer slots plus the one repair (`aiBudgetV2OrdinalCeiling`). */
  maxCalls: number;
  /** Add-on spec §5.4 / plan C4: `false` for an image intake, which never spends AI credit. */
  fundsAiCredit?: boolean;
  /** The turn's admission instant: a cut-over company's cycle and lots are judged as of then. */
  fundingAsOf?: Date;
  /** The cycle this turn's first funded call pinned, so the whole turn stays on it (A36). */
  pinnedCycleKey?: string;
  /** `funding` is present only for a funded call; the issuer pins its cycle in `budgetAuthorityJson`. */
  authorizeAndClaim(tx: any, funding?: { cycleKey: string }): Promise<boolean>;
};

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
  rendered?: RenderedAiReservationAuthority,
): Promise<AiBudgetReserveOutcome> {
  if (rendered && (input.stepKind !== 'provider-v2' || !Number.isSafeInteger(rendered.upperBoundSatang) || rendered.upperBoundSatang < 0
    || ![2, 3, 4, 5].includes(rendered.maxCalls))) return { ok: false, reason: 'unavailable', budgetScope: 'TOTAL', detail: 'invalid_rendered_authority' };
  const bounds = rendered ? { ...rendered.snapshot.bounds, maxCalls: rendered.maxCalls } : aiBudgetStepBounds(input.stepKind);
  // A seam whose bound nobody declared can never be reserved — the ADR 0013 §9 readiness property.
  if (!bounds) return { ok: false, reason: 'unavailable', budgetScope: 'TOTAL', detail: 'step_bound_missing' };
  if (input.ordinal < 0 || input.ordinal >= bounds.maxCalls) {
    return { ok: false, reason: 'unavailable', budgetScope: 'TOTAL', detail: 'step_call_budget_exhausted' };
  }
  if (!BUCKET_ORDER.includes(input.bucket)) {
    return { ok: false, reason: 'unavailable', budgetScope: 'TOTAL', detail: 'bucket_unknown' };
  }
  if (!input.modelId) return { ok: false, reason: 'unavailable', budgetScope: 'TOTAL', detail: 'model_unknown' };
  const priced = rendered ?? priceAiStepUpperBound(input.stepKind, input.modelId, input.thbPerUsd);
  if (!priced) return { ok: false, reason: 'unavailable', budgetScope: 'TOTAL', detail: 'price_unavailable' };

  const now = input.now ?? new Date();
  const invocationKey = aiBudgetInvocationKey(input.companyId, input.attemptKey, input.stepKind, input.ordinal);
  const ownerToken = randomUUID();

  try {
    const result = await prisma.client.$transaction(async (tx: any) => {
      // Canonical lock order (spec §12.7): company config -> platform (only when this company
      // inherits the default, see `resolveBudgetUnderLock`) -> company-month budget. The config
      // lock is shared with the admin writer, so a cap change and an admission can never pass each
      // other reading different policy states.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`partner-ocr-config:${input.companyId}`}))`;
      const budget = await resolveBudgetUnderLock(tx, config, input.companyId, input.monthKey);
      const { policy } = budget;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ai-budget:${input.companyId}:${input.monthKey}`}))`;

      // R-03: the execution fence comes first inside the money lock. A redelivered webhook must
      // never buy a second hold.
      const claimed = await tx.aiBudgetReservation.findUnique({
        where: { invocationKey }, select: { id: true, status: true },
      });
      if (claimed) return { ok: false as const, reason: 'already_claimed' as const, status: claimed.status, reservationId: claimed.id };

      if (policy.invalidReason) {
        return { ok: false as const, reason: 'unavailable' as const, budgetScope: 'TOTAL' as AiBudgetScope, detail: policy.invalidReason };
      }
      if (policy.mode !== 'SPLIT' && !rendered) {
        return { ok: false as const, reason: 'unavailable' as const, budgetScope: 'TOTAL' as AiBudgetScope, detail: 'policy_not_split' };
      }
      // Add-on spec §5.3/§18.3: once a company is cut over, its AI credit lots replace the SHARED
      // calendar CHAT cap on the rendered LINE path. TOTAL, and an explicit SPLIT CHAT cap, still apply.
      const fundingAsOf = rendered?.fundingAsOf ?? now;
      const cutOver = !!rendered && input.bucket === 'CHAT' && budget.cutoverAt !== null && budget.cutoverAt <= fundingAsOf;
      const capSatang = input.bucket === 'CHAT' ? (cutOver && policy.mode === 'SHARED' ? policy.totalSatang : policy.chatCapSatang)
        : policy.mode === 'SHARED' && rendered ? policy.totalSatang : policy.ocrCapSatang;
      if (capSatang === null) {
        return { ok: false as const, reason: 'unavailable' as const, budgetScope: input.bucket as AiBudgetScope, detail: 'bucket_cap_missing' };
      }

      await sweepCompanyMonth(tx, input.companyId, input.monthKey, now);

      // Owner 2026-10-19: overrun is an alert, never an operator-acknowledgement admission lock.

      const spend = await liveSpend(tx, input.companyId, input.monthKey, input.bucket);
      const reserved = await liveReserved(tx, input.companyId, input.monthKey, input.bucket);
      const bound = priced.upperBoundSatang;

      const decision = decideAiBudgetStep({
        bucket: input.bucket, boundSatang: bound, totalSatang: policy.totalSatang, capSatang,
        spent: spend, reserved, override: policy.override,
      });
      // A cap of 0 is an admin's explicit closure (Owner 2026-09-30 "ไม่ทำต่อ"): never passed over.
      const closedByAdmin = policy.totalSatang === 0 || capSatang === 0;
      if (!decision.ok && (!input.admitOverCap || closedByAdmin)) return decision;
      if (!decision.ok) {
        logger.warn({ msg: 'ai.budget.admitted_over_cap', companyId: input.companyId, monthKey: input.monthKey,
          budgetScope: decision.budgetScope, stepKind: input.stepKind, ordinal: input.ordinal });
      }

      // Funding is decided BEFORE the ordinal claim: a refusal returns (commits) without burning the
      // turn's ordinal. Still under `partner-ocr-config` (L1), so two months or two turns can never
      // spend the same lot twice (spec §8.3).
      let funding: Extract<AiCreditFunding, { ok: true }> | undefined;
      if (cutOver && rendered!.fundsAiCredit !== false) {
        const funded = await planAiCreditFunding(tx, {
          companyId: input.companyId, units: bound, asOf: fundingAsOf, now, pinnedCycleKey: rendered!.pinnedCycleKey,
          allowance: (cycle) => aiCreditCycleAllowance({ row: budget.row, totalSatang: budget.totalSatang, override: budget.override,
            monthKey: input.monthKey, at: cycle.start }),
        });
        if (!funded.ok) return aiCreditRefusal(funded);
        funding = funded;
      }
      if (rendered && !await rendered.authorizeAndClaim(tx, funding && { cycleKey: funding.cycleKey })) {
        return { ok: false as const, reason: 'unavailable' as const, budgetScope: 'TOTAL' as AiBudgetScope, detail: 'authority_stale' };
      }
      const created = await tx.aiBudgetReservation.create({
        data: {
          companyId: input.companyId, monthKey: input.monthKey, bucket: input.bucket,
          policyRevision: policy.revision, sourceRoute: input.sourceRoute, stepKind: input.stepKind,
          attemptKey: input.attemptKey, invocationKey, upperBoundSatang: bound,
          pricingSnapshot: { ...priced.snapshot, thbPerUsdSource: input.thbPerUsdSource,
            // The marker settlement reads: only a funded hold has AI credit entries to turn into use.
            ...(funding ? { aiCredit: { cycleKey: funding.cycleKey, asOf: fundingAsOf.toISOString() } } : {}),
            // The marker `budget-step` reads, so every further call of this turn inherits it.
            ...(input.admitOverCap ? { admitOverCap: true } : {}) },
          requestKind: input.requestKind ?? null, status: rendered ? 'DISPATCHED' : 'RESERVED', ownerToken,
          ...(rendered ? { dispatchedAt: now } : {}),
        },
        select: { id: true },
      });
      if (funding) await writeAiCreditHold(tx, { companyId: input.companyId, reservationId: created.id, allocations: funding.allocations });
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
    if (result.ok) {
      const snapshot = priced.snapshot as typeof priced.snapshot & Record<string, unknown>;
      // The reserve contract carries a profile, not the provider tag; settlement logs the actual tag.
      try {
        logger.log({ msg: 'ai.budget.reserved', companyId: input.companyId, reservationId: result.reservation.id,
          profileId: snapshot.profileId ?? null, usageTag: snapshot.usageTag ?? null, estimatorVersion: snapshot.estimatorVersion ?? null,
          inputTokenBound: bounds.maxInputTokens, outputBound: bounds.maxOutputTokens, holdSatang: result.reservation.upperBoundSatang });
      } catch { /* Observability cannot change a committed reservation. */ }
    }
    return result;
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

/**
 * Did the GATEWAY refuse this invocation before its provider ran? (Phase E1c.)
 *
 * The gateway's own money guard refuses a call whose model, `maxTokens`, request size or call index
 * is outside the declared envelope, and refuses every call of a request whose envelope did not
 * validate. Such an answer carries one of OUR refusal codes and NO usage row at all — the decorator
 * refuses before the provider, and both providers append a row for every call they make. That pair
 * is the proof: a code we emit, plus zero rows, means nothing was spent on this invocation.
 *
 * Deliberately strict in the "spent" direction: ANY usage row on the response blocks the release,
 * because a chain refused at ordinal >= 1 (the read already ran, the extract could not be funded)
 * carries the earlier call's row and must keep paying for it. An untagged row counts too — the
 * response path settles the first one against this very invocation.
 *
 * This is NOT `isOcrPreProviderRefusal`, on purpose: that predicate also drives the OCR READ-COUNT
 * refund, and R-05 requires count refunds and money releases to stay structurally separate.
 */
export function gatewayRefusedWithoutSpending(
  budgetCode: string | null | undefined,
  usage: AiUsageEntry[] | undefined,
): boolean {
  return isAiBudgetRefusalCode(budgetCode) && (usage?.length ?? 0) === 0;
}

/**
 * Releases the hold of an invocation the gateway refused before its provider (E1c).
 *
 * Without this, one misdeclared bound piles up permanent `DISPATCHED -> UNRESOLVED` holds and
 * closes a bucket with nothing spent. `gateway_pre_provider_refusal` is the existing proof and the
 * existing owner-token fence applies. If evidence for this invocation somehow arrives afterwards,
 * it is still recorded IN FULL through the `settled-anomaly` path (§11.6) with a HIGH event — a
 * wrong cancel proof can never turn real provider cost into zero.
 *
 * A refusal at ordinal >= 1 reaches here with the PARENT's hold and the parent's usage row, so the
 * guard above declines: the child step was refused before it reserved anything, so there is no
 * child hold to release either way.
 */
export async function cancelAiBudgetStepIfGatewayUnspent(
  prisma: PrismaService,
  hold: ReservedAiBudgetStep | undefined,
  answer: { budgetCode?: string | null; usage?: AiUsageEntry[] },
): Promise<boolean> {
  if (!hold || !gatewayRefusedWithoutSpending(answer.budgetCode, answer.usage)) return false;
  const cancelled = await cancelAiBudgetStep(prisma, {
    reservationId: hold.id, ownerToken: hold.ownerToken, proof: 'gateway_pre_provider_refusal',
  });
  logger.warn({ msg: 'ai.budget.gateway_refusal_released', companyId: hold.companyId,
    stepKind: hold.stepKind, budgetCode: answer.budgetCode, cancelled });
  return cancelled;
}

// ── Operator reconciliation of stranded money (hold spec §4.2) ───────────────────────────────────

/**
 * What every operator decision carries. `companyId` is the ROUTE parameter and is compared with the
 * row's own: a reservation id belonging to another tenant must answer "not found", never act.
 */
export type AiBudgetOperatorDecision = {
  reservationId: string;
  companyId: string;
  actorUserId: string;
  requestId: string;
  /** Already validated by `partnerAdjustmentReason` at the boundary; stored on the row and audited. */
  reason: string;
  now?: Date;
};

export type AiBudgetOperatorOutcome =
  | { ok: true; status: 'CANCELLED' | 'SETTLED'; chargedSatang: number }
  /** No such hold in THIS company, or the row is not the kind this action can act on. */
  | { ok: false; reason: 'not-found' }
  /** The fence held: another operator (or real evidence) already closed this hold. */
  | { ok: false; reason: 'already-resolved' }
  | { ok: false; reason: 'already-acknowledged' }
  | { ok: false; reason: 'failed' };

/** Audit action strings, passed in so the taxonomy stays in the audit module (`AuditAction`). */
export type AiBudgetOperatorAudit = { action: string; riskLevel?: 'HIGH' | 'CRITICAL' };

/** The one place an operator decision becomes an `AuditLog` row — inside the deciding transaction,
 *  so money can never move without its history row (`PartnerAiAdjustmentHistory` reads these). */
async function writeOperatorAudit(
  tx: any,
  input: AiBudgetOperatorDecision,
  audit: AiBudgetOperatorAudit,
  metadata: Record<string, unknown>,
): Promise<void> {
  await tx.auditLog.create({
    data: {
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      action: audit.action,
      // `company`, not the reservation: this is the row `partnerAiAdjustmentHistory` reads, and an
      // operator asking "what was done to this shop's AI credit" must see cap edits and hold
      // decisions in ONE list. The reservation id travels in the metadata below.
      targetType: 'company',
      targetId: input.companyId,
      requestId: input.requestId,
      result: 'SUCCESS',
      riskLevel: audit.riskLevel ?? 'CRITICAL',
      metadataJson: {
        source: 'ADMIN_ADJUSTMENT', entryPoint: 'SYSTEM_PARTNER_ADMIN', reason: input.reason,
        reservationId: input.reservationId, ...metadata,
      },
    },
  });
}

/** The locator read every operator action starts from. Nothing is DECIDED from it — the row is
 *  re-read under the lock — it only supplies the lock key and the 404. */
async function findOperatorHold(prisma: PrismaService, input: AiBudgetOperatorDecision) {
  return prisma.client.aiBudgetReservation.findUnique({
    where: { id: input.reservationId },
    select: {
      companyId: true, monthKey: true, status: true, bucket: true, stepKind: true,
      invocationKey: true, upperBoundSatang: true, breach: true, breachAcknowledgedAt: true,
      pricingSnapshot: true,
    },
  }) as Promise<{
    companyId: string; monthKey: string; status: string; bucket: string; stepKind: string;
    invocationKey: string; upperBoundSatang: number; breach: boolean; breachAcknowledgedAt: Date | null;
    pricingSnapshot: unknown;
  } | null>;
}

/**
 * `UNRESOLVED -> CANCELLED` by an operator's audited decision (hold spec §4.2). The held credit is
 * free immediately and NO usage event is written — this asserts the provider was never paid.
 *
 * Fenced on `status = 'UNRESOLVED'` under the company-month lock, so two operators pressing the
 * button race to exactly one winner and the loser gets `already-resolved`. The owner token is
 * deliberately NOT required: a stranded hold's owner process is gone, which is why it is stranded.
 * `cancelAiBudgetStep` keeps its owner fence for the machine proofs (R-05) and this is a sibling
 * path rather than a weakening of it.
 *
 * If real evidence for this invocation arrives later it is still recorded IN FULL through the
 * `settled-anomaly` path (ADR 0013 §11.6) with a HIGH event, so a wrong release can overshoot the
 * month's cap but can never turn real provider cost into zero.
 */
export async function releaseAiBudgetHoldByOperator(
  prisma: PrismaService,
  input: AiBudgetOperatorDecision,
  audit: AiBudgetOperatorAudit,
): Promise<AiBudgetOperatorOutcome> {
  const now = input.now ?? new Date();
  try {
    const row = await findOperatorHold(prisma, input);
    if (!row || row.companyId !== input.companyId) return { ok: false, reason: 'not-found' };
    return await prisma.client.$transaction(async (tx: any) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ai-budget:${row.companyId}:${row.monthKey}`}))`;
      const { count } = await tx.aiBudgetReservation.updateMany({
        where: { id: input.reservationId, companyId: input.companyId, status: 'UNRESOLVED' },
        data: {
          status: 'CANCELLED',
          evidenceJson: {
            proof: 'operator_released' satisfies AiBudgetCancelProof,
            cancelledAt: now.toISOString(),
            operator: { userId: input.actorUserId, reason: input.reason },
          },
        },
      });
      if (count !== 1) return { ok: false as const, reason: 'already-resolved' as const };
      await writeOperatorAudit(tx, input, audit, {
        monthKey: row.monthKey, bucket: row.bucket, stepKind: row.stepKind,
        releasedSatang: row.upperBoundSatang, proof: 'operator_released',
        fromCreditHoldStatus: 'UNRESOLVED', toCreditHoldStatus: 'CANCELLED',
      });
      return { ok: true as const, status: 'CANCELLED' as const, chargedSatang: 0 };
    });
  } catch (err) {
    logger.warn({ msg: 'ai.budget.operator_release_failed', reservationId: input.reservationId, error: (err as Error).message });
    return { ok: false, reason: 'failed' };
  }
}

/**
 * `breach = true, breachAcknowledgedAt IS NULL -> acknowledged` (hold spec §4.2). Touches no money:
 * the recorded actual and the `breach` fact both stay exactly as they are. What changes is that
 * {@link readAiBudgetMonthSnapshot} stops counting this alert. Admission does not depend on it.
 */
export async function acknowledgeAiBudgetBreach(
  prisma: PrismaService,
  input: AiBudgetOperatorDecision,
  audit: AiBudgetOperatorAudit,
): Promise<AiBudgetOperatorOutcome> {
  const now = input.now ?? new Date();
  try {
    const row = await findOperatorHold(prisma, input);
    if (!row || row.companyId !== input.companyId || !row.breach) return { ok: false, reason: 'not-found' };
    return await prisma.client.$transaction(async (tx: any) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ai-budget:${row.companyId}:${row.monthKey}`}))`;
      const { count } = await tx.aiBudgetReservation.updateMany({
        where: { id: input.reservationId, companyId: input.companyId, breach: true, breachAcknowledgedAt: null },
        data: { breachAcknowledgedAt: now, breachAcknowledgedByUserId: input.actorUserId },
      });
      if (count !== 1) return { ok: false as const, reason: 'already-acknowledged' as const };
      await writeOperatorAudit(tx, input, audit, {
        monthKey: row.monthKey, bucket: row.bucket, stepKind: row.stepKind,
        boundSatang: row.upperBoundSatang,
        fromCreditBreachAcknowledged: false, toCreditBreachAcknowledged: true,
      });
      return { ok: true as const, status: 'SETTLED' as const, chargedSatang: 0 };
    });
  } catch (err) {
    logger.warn({ msg: 'ai.budget.operator_ack_failed', reservationId: input.reservationId, error: (err as Error).message });
    return { ok: false, reason: 'failed' };
  }
}

/**
 * `UNRESOLVED -> SETTLED` at the hold's OWN declared upper bound (hold spec §4.2): the operator has
 * decided the provider probably was paid and the conservative number is the honest one.
 *
 * It goes through {@link settleAiBudgetStep} rather than writing its own rows, so the money lands
 * through the one writer that owns the `invocationKey` fence, the fixed aggregate row order and the
 * pinned month. That is also what makes a double charge impossible: the second attempt finds the
 * row no longer `UNRESOLVED`.
 */
export async function chargeAiBudgetHoldAtBound(
  prisma: PrismaService,
  input: AiBudgetOperatorDecision,
  audit: AiBudgetOperatorAudit,
): Promise<AiBudgetOperatorOutcome> {
  const row = await findOperatorHold(prisma, input);
  if (!row || row.companyId !== input.companyId) return { ok: false, reason: 'not-found' };
  const result = await settleAiBudgetStep(prisma, {
    invocationKey: row.invocationKey,
    // Zero tokens on purpose: nothing was measured. The cost is the reservation's own bound, which
    // `settleAiBudgetStep` reads from the row — never from these counters.
    entry: {
      tag: 'ai.credit_hold.charged_at_bound', modelId: operatorChargeModelId(row), ok: true,
      inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheWriteInputTokens: 0,
      durationMs: 0, usageBasis: 'OPERATOR_CHARGED_AT_BOUND',
    },
    meta: { sourceRoute: 'operator-credit-hold', requestId: input.requestId },
    ...(input.now ? { now: input.now } : {}),
    operator: { chargeAtBound: true, decision: input, audit },
  });
  if (result === 'settled') return { ok: true, status: 'SETTLED', chargedSatang: row.upperBoundSatang };
  if (result === 'unknown-invocation') return { ok: false, reason: 'not-found' };
  if (result === 'operator-hold-not-unresolved' || result === 'duplicate') return { ok: false, reason: 'already-resolved' };
  return { ok: false, reason: 'failed' };
}

/**
 * `AiUsageEvent.modelId` is NOT NULL, and the model the invocation was PRICED for is the honest
 * answer: it is the model that would have run, the prices are the ones the bound was computed from,
 * and `usageBasis` already says the number is an operator decision rather than a measurement. Only
 * an unreadable snapshot falls back to naming the decision itself.
 */
function operatorChargeModelId(row: { stepKind: string; pricingSnapshot: unknown }): string {
  const snapshot = (row.pricingSnapshot ?? {}) as { modelId?: unknown };
  return typeof snapshot.modelId === 'string' && snapshot.modelId !== ''
    ? snapshot.modelId
    : `operator:charged-at-bound:${row.stepKind}`;
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
  /**
   * Provider evidence arrived for a hold that was `RESERVED` (the dispatch mark was lost) or
   * `CANCELLED` (a cancel proof was wrong). The money is REAL, so it is recorded in full exactly
   * like a normal settlement — the anomaly is recorded beside it and alerted, never used as a
   * reason to drop the usage (spec §12.6: real cost must not become zero).
   */
  | 'settled-anomaly'
  /** Operator mode only: the hold this decision named is no longer `UNRESOLVED` (hold spec §4.2). */
  | 'operator-hold-not-unresolved'
  | 'failed';

export type SettleAiBudgetStepInput = {
  invocationKey: string;
  entry: AiUsageEntry;
  externalUnits?: number | null;
  meta: { sourceRoute: string; requestId?: string; requestKind?: AiRequestKind };
  now?: Date;
  /**
   * The operator "charge at the declared bound" decision (hold spec §4.2). Present ⇒ the cost is
   * the reservation's OWN `upperBoundSatang` instead of a price computed from the evidence, the row
   * is fenced on `status = 'UNRESOLVED'`, the event is a `COST_ADJUSTMENT` (so it is money without
   * a model call, exactly like a correction), and the audit row is written in THIS transaction.
   *
   * Absent ⇒ every byte of the machine settlement path below behaves as before.
   */
  operator?: { chargeAtBound: true; decision: AiBudgetOperatorDecision; audit: AiBudgetOperatorAudit };
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
  let settledLog: Record<string, unknown> | undefined;
  let breach: { companyId: string; monthKey: string; bucket: string; reservationId: string; boundSatang: number; actualSatang: number; customerChargedSatang: number; companyAbsorbedSatang: number } | undefined;
  let anomaly: { companyId: string; monthKey: string; bucket: string; reservationId: string; invariant: string } | undefined;
  try {
    const result = await prisma.client.$transaction(async (tx: any) => {
      // Locator read only: the lock string needs the company and the month. Nothing is decided from
      // it — the authoritative row is re-read BELOW, under the lock, so the status check can never
      // run on a row a concurrent cancel or settle has already moved.
      const locator = await tx.aiBudgetReservation.findUnique({
        where: { invocationKey: input.invocationKey }, select: { companyId: true, monthKey: true },
      });
      if (!locator) return 'unknown-invocation' as const;
      // Credit lots span months: serialize overrun debits with reserve/revoke under the same L1.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`partner-ocr-config:${locator.companyId}`}))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ai-budget:${locator.companyId}:${locator.monthKey}`}))`;
      const reservation = await tx.aiBudgetReservation.findUnique({ where: { invocationKey: input.invocationKey } });
      if (!reservation) return 'unknown-invocation' as const;

      const operator = input.operator;
      // An operator decision is fenced BEFORE the duplicate check, because "someone already closed
      // this hold" must be a refusal the operator sees (409), never a silent success.
      if (operator) {
        if (reservation.companyId !== operator.decision.companyId) return 'unknown-invocation' as const;
        if (reservation.status !== 'UNRESOLVED') return 'operator-hold-not-unresolved' as const;
      }

      const already = await tx.aiUsageEvent.findUnique({ where: { invocationKey: input.invocationKey }, select: { id: true } });
      if (already || reservation.status === 'SETTLED') return 'duplicate' as const;
      // `DISPATCHED` is the normal case and `UNRESOLVED` is late evidence closing a hold nobody
      // could resolve. `RESERVED` and `CANCELLED` mean the dispatch mark or a cancel proof was
      // wrong — the provider still ran and still cost money, so the evidence is recorded in FULL
      // and the anomaly is alerted. Dropping it would be the "usage หาย" failure of spec §12.6.
      const anomalous = reservation.status === 'RESERVED' || reservation.status === 'CANCELLED';

      const snapshot = (reservation.pricingSnapshot ?? {}) as { thbPerUsd?: unknown; thbPerUsdSource?: unknown };
      const thbPerUsd = Number(snapshot.thbPerUsd);
      if (!Number.isFinite(thbPerUsd) || thbPerUsd <= 0) return 'invalid-state' as const;
      // The operator charged the DECLARED bound, which is the number this hold has been holding all
      // along — never a price recomputed from the zero counters the decision carries.
      const absorbed = !operator && input.entry.ok === false;
      const isV2 = (reservation.pricingSnapshot as { contractVersion?: number }).contractVersion === 2;
      const pinned = isV2 && !operator ? computePinnedAiCostV2(reservation.pricingSnapshot as AiRenderedPricingSnapshotV2, input.entry, absorbed ? input.externalUnits ?? (reservation.pricingSnapshot as AiRenderedPricingSnapshotV2).externalUnitBound : input.externalUnits) : null;
      if (isV2 && !operator && !absorbed && !pinned) {
        // Preserve the paid evidence while the hosted-unit/tariff discrepancy is reconciled.
        await tx.aiBudgetReservation.update({ where: { id: reservation.id }, data: { status: 'UNRESOLVED', evidenceJson: {
          reason: 'TARIFF_OR_EXTERNAL_USAGE_UNRESOLVED', entry: { modelId: input.entry.modelId, tag: input.entry.tag, ok: input.entry.ok,
            inputTokens: input.entry.inputTokens, outputTokens: input.entry.outputTokens, cacheReadInputTokens: input.entry.cacheReadInputTokens, cacheWriteInputTokens: input.entry.cacheWriteInputTokens,
            usageBasis: normalizeUsageBasis((input.entry as { usageBasis?: unknown }).usageBasis) },
          externalUnits: input.externalUnits ?? null,
        } } });
        return 'invalid-evidence' as const;
      }
      const costSatang = operator ? reservation.upperBoundSatang : pinned?.costSatang ?? computeCostSatang(input.entry, thbPerUsd).costSatang;
      // Money without a provider call, exactly like an audited cost correction: `COST_ADJUSTMENT`
      // is what keeps it out of `calls` and out of `coverage` in the D1 breakdown while its cost
      // still reconciles with the month total (hold spec J-07).
      const eventKind = operator ? 'COST_ADJUSTMENT' : 'MODEL_CALL';
      const callCount = operator ? 0 : 1;
      const usageBasis = operator
        ? 'OPERATOR_CHARGED_AT_BOUND'
        : absorbed ? 'COMPANY_ABSORBED' : normalizeUsageBasis((input.entry as { usageBasis?: unknown }).usageBasis);

      await tx.aiUsageEvent.create({
        data: {
          companyId: reservation.companyId, monthKey: reservation.monthKey,
          sourceRoute: input.meta.sourceRoute, usageTag: input.entry.tag, modelId: input.entry.modelId,
          ok: input.entry.ok, inputTokens: input.entry.inputTokens, outputTokens: input.entry.outputTokens,
          cacheReadInputTokens: input.entry.cacheReadInputTokens, cacheWriteInputTokens: input.entry.cacheWriteInputTokens,
          costSatang, thbPerUsd, thbPerUsdSource: String(snapshot.thbPerUsdSource ?? 'reservation'),
          requestId: input.meta.requestId,
          // The caller's own classification wins; otherwise the one PINNED on the hold at reserve
          // time, so a gateway-driven settlement is never UNKNOWN in the D1 breakdown.
          requestKind: input.meta.requestKind ?? reservation.requestKind ?? null,
          budgetBucket: reservation.bucket,
          usageBasis,
          eventKind, pricingSnapshot: pinned?.pricingSnapshot ?? buildPricingSnapshot(input.entry, thbPerUsd, costSatang),
          invocationKey: input.invocationKey,
        },
      });
      if (!absorbed) {
        const delta = {
          costSatang, inputTokens: input.entry.inputTokens, outputTokens: input.entry.outputTokens,
          cacheReadInputTokens: input.entry.cacheReadInputTokens, cacheWriteInputTokens: input.entry.cacheWriteInputTokens,
        };
        // Row order is FIXED across every writer of these two tables (`recordCompanyAiUsage`, this
        // function and `recordCompanyAiCostAdjustment`): month aggregate FIRST, then the bucket rows
        // in CHAT-before-OCR order. Two transactions taking them in opposite orders is a textbook
        // deadlock, and the victim's usage would be LOST, not retried.
        //
        // The PINNED month, never the clock's: a chain that crosses Bangkok midnight still lands here.
        await tx.companyAiMonthlyUsage.upsert({
          where: { companyId_monthKey: { companyId: reservation.companyId, monthKey: reservation.monthKey } },
          create: { companyId: reservation.companyId, monthKey: reservation.monthKey, callCount, ...delta },
          update: {
            costSatang: { increment: delta.costSatang }, callCount: { increment: callCount },
            inputTokens: { increment: delta.inputTokens }, outputTokens: { increment: delta.outputTokens },
            cacheReadInputTokens: { increment: delta.cacheReadInputTokens },
            cacheWriteInputTokens: { increment: delta.cacheWriteInputTokens },
          },
        });
        await upsertBucketUsage(tx, reservation.companyId, reservation.monthKey, reservation.bucket, costSatang, callCount);
      }

      // Provider cost remains complete; credit debits are independently capped at available funds.
      // An operator charge lands exactly ON the bound, so this decision can never open a breach.
      const breached = !absorbed && (costSatang > reservation.upperBoundSatang
        || isV2 && !operator && typeof input.externalUnits === 'number'
          && input.externalUnits > (reservation.pricingSnapshot as AiRenderedPricingSnapshotV2).externalUnitBound);
      const credit = (reservation.pricingSnapshot as { aiCredit?: { cycleKey: string; asOf?: string } }).aiCredit;
      const customerChargedSatang = !absorbed && credit && reservation.status !== 'CANCELLED'
        ? await consumeAiCreditHold(tx, { companyId: reservation.companyId, reservationId: reservation.id, costSatang,
          ...(isV2 && !operator && breached ? { overrun: { cycleKey: credit.cycleKey,
            asOf: new Date(credit.asOf ?? reservation.createdAt ?? now) } } : {}) })
        : absorbed || credit ? 0 : costSatang;
      const companyAbsorbedSatang = costSatang - customerChargedSatang;
      await tx.aiBudgetReservation.update({
        where: { id: reservation.id },
        data: {
          status: absorbed ? 'CANCELLED' : 'SETTLED', settledCostSatang: absorbed ? 0 : costSatang, settledAt: now, breach: breached,
          usageBasis,
          evidenceJson: { tag: input.entry.tag, modelId: input.entry.modelId, ok: input.entry.ok,
            customerChargedSatang, companyAbsorbedSatang,
            ...(absorbed ? { reason: 'COMPANY_ABSORBED', absorbedCostSatang: costSatang, cancelledAt: now.toISOString(),
              providerUsageBasis: normalizeUsageBasis(input.entry.usageBasis),
              ...(typeof input.entry.errorCode === 'string' ? { errorCode: input.entry.errorCode.slice(0, 64) } : {}) } : {}),
            inputTokens: input.entry.inputTokens, outputTokens: input.entry.outputTokens,
            cacheReadInputTokens: input.entry.cacheReadInputTokens, cacheWriteInputTokens: input.entry.cacheWriteInputTokens,
            ...(isV2 ? { externalUnits: input.externalUnits ?? null, contractVersion: 2 } : {}),
            // What the row was when real evidence arrived, so reconciliation can see it.
            ...(anomalous ? { anomaly: { previousStatus: reservation.status } } : {}),
            // Who decided, and why — the row itself says it was not measured.
            ...(operator ? { operator: { action: 'charge_at_bound', userId: operator.decision.actorUserId, reason: operator.decision.reason } } : {}) },
        },
      });
      // In the SAME transaction as the money: an operator's money decision may never commit
      // without its audit (and therefore history) row.
      if (operator) {
        await writeOperatorAudit(tx, operator.decision, operator.audit, {
          monthKey: reservation.monthKey, bucket: reservation.bucket, stepKind: reservation.stepKind,
          chargedSatang: costSatang, usageBasis: 'OPERATOR_CHARGED_AT_BOUND',
          fromCreditHoldStatus: 'UNRESOLVED', toCreditHoldStatus: 'SETTLED',
        });
      }
      if (breached) {
        breach = { companyId: reservation.companyId, monthKey: reservation.monthKey, bucket: reservation.bucket,
          reservationId: reservation.id, boundSatang: reservation.upperBoundSatang, actualSatang: costSatang,
          customerChargedSatang, companyAbsorbedSatang };
      }
      if (anomalous) {
        anomaly = { companyId: reservation.companyId, monthKey: reservation.monthKey, bucket: reservation.bucket,
          reservationId: reservation.id, invariant: `evidence_for_${String(reservation.status).toLowerCase()}_hold` };
      }
      settledLog = { msg: 'ai.budget.settled', reservationId: reservation.id, usageTag: input.entry.tag, settledSatang: costSatang,
        holdSatang: reservation.upperBoundSatang, inputTokens: input.entry.inputTokens,
        cacheReadInputTokens: input.entry.cacheReadInputTokens, cacheWriteInputTokens: input.entry.cacheWriteInputTokens,
        outputTokens: input.entry.outputTokens, overrun: breached, customerChargedSatang, companyAbsorbedSatang };
      return anomalous ? 'settled-anomaly' as const : 'settled' as const;
    });
    // Post-commit, the `admitCompanyOcr` precedent: an observability write must never abort a
    // settlement that already holds the money truthfully.
    if (settledLog) {
      try { logger.log(settledLog); } catch { /* Observability cannot change a committed settlement. */ }
    }
    if (breach) emitSecurityEvent(logger, SECURITY_EVENT.aiCompanyBudgetExceeded, 'HIGH', { ...breach, invariant: 'actual_above_reserved_bound' });
    if (anomaly) emitSecurityEvent(logger, SECURITY_EVENT.aiCompanyBudgetExceeded, 'HIGH', anomaly);
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
  const breached = await tx.aiBudgetReservation.count({ where: { ...UNACKNOWLEDGED_BREACH, companyId, monthKey } });
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

/** Read-only admission hint. The provider reservation still makes the spending decision. */
export async function readCompanyAiCreditState(tx: any, config: AppConfigService, companyId: string, now: Date) {
  const monthKey = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }).slice(0, 7);
  const budget = await resolveBudgetUnderLock(tx, config, companyId, monthKey, false, now);
  const { policy } = budget;
  if (policy.invalidReason) return { ok: false as const, reason: 'unavailable' as const, budgetScope: 'TOTAL' as const, detail: policy.invalidReason };
  const snapshot = await readAiBudgetMonthSnapshot(tx, companyId, monthKey);
  const cutOver = budget.cutoverAt !== null && budget.cutoverAt <= now;
  const capSatang = cutOver && policy.mode === 'SHARED' ? policy.totalSatang : policy.chatCapSatang;
  if (capSatang === null) return { ok: false as const, reason: 'unavailable' as const, budgetScope: 'CHAT' as const, detail: 'bucket_cap_missing' };
  const decision = decideAiBudgetStep({ bucket: 'CHAT', boundSatang: 0,
    totalSatang: policy.totalSatang, capSatang, override: policy.override,
    spent: { total: snapshot.spent.TOTAL, bucket: snapshot.spent.CHAT },
    reserved: { total: snapshot.reserved.TOTAL, bucket: snapshot.reserved.CHAT } });
  if (!decision.ok || !cutOver) return decision;
  const balance = await readAiCreditBalance(tx, { companyId, at: now,
    allowance: cycle => aiCreditCycleAllowance({ row: budget.row, totalSatang: budget.totalSatang,
      override: budget.override, monthKey, at: cycle.start }) });
  if (!balance.cycle && (await tx.company.findUnique({ where: { id: companyId }, select: { reportClassification: true } }))?.reportClassification !== 'DEMO') return aiCreditRefusal({ ok: false, cause: 'PACKAGE_REQUIRED', availableUnits: 0 });
  if (balance.totalRemainingUnits <= 0) return aiCreditRefusal({ ok: false, cause: 'EXHAUSTED', availableUnits: 0 });
  return { ok: true as const };
}

/**
 * The operator's reconciliation list for one company and a set of pinned months (hold spec §4.1).
 *
 * Two kinds of row, read in one query because they are the same table and the operator triages them
 * together: an `UNRESOLVED` hold (money held with no outcome) and an UNACKNOWLEDGED `breach` (money
 * recorded above its bound, requiring operator review). Newest first.
 *
 * Money, ids, timestamps and declared kinds only — never a prompt, a message or a LINE identifier.
 * The invocation key is shortened here rather than in the DTO mapper so the full execution identity
 * never leaves this file.
 */
export type AiBudgetCreditHoldRow = {
  id: string;
  status: string;
  kind: 'UNRESOLVED_HOLD' | 'BREACH';
  stepKind: string;
  bucket: string;
  sourceRoute: string;
  requestKind: string | null;
  upperBoundSatang: number;
  settledCostSatang: number | null;
  monthKey: string;
  createdAt: Date;
  dispatchedAt: Date | null;
  invocationKeyShort: string;
};

export async function listAiBudgetCreditHolds(
  prisma: PrismaService,
  companyId: string,
  /** `null` = every month (add-on spec §18.4 item 7, C11): a hold older than two months, or one
   *  funded by AI credit lots, must still be found and closed from its source. */
  monthKeys: string[] | null,
  page: { take?: number; before?: { createdAt: Date; id: string } } = {},
): Promise<AiBudgetCreditHoldRow[]> {
  const rows = await prisma.client.aiBudgetReservation.findMany({
    where: {
      companyId,
      ...(monthKeys ? { monthKey: { in: monthKeys } } : {}),
      OR: [{ status: 'UNRESOLVED' }, { ...UNACKNOWLEDGED_BREACH }],
      ...(page.before ? { AND: [{ OR: [{ createdAt: { lt: page.before.createdAt } },
        { createdAt: page.before.createdAt, id: { lt: page.before.id } }] }] } : {}),
    },
    select: {
      id: true, status: true, stepKind: true, bucket: true, sourceRoute: true, requestKind: true,
      upperBoundSatang: true, settledCostSatang: true, monthKey: true, createdAt: true,
      dispatchedAt: true, invocationKey: true, breach: true, breachAcknowledgedAt: true,
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    // Only stranded rows land here. Across all months the caller pages by (createdAt, id).
    take: page.take ?? 200,
  });
  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    // A row can be both; the breach is the one that closes a scope, so it wins the label.
    kind: row.breach && row.breachAcknowledgedAt === null ? 'BREACH' : 'UNRESOLVED_HOLD',
    stepKind: row.stepKind,
    bucket: row.bucket,
    sourceRoute: row.sourceRoute,
    requestKind: row.requestKind,
    upperBoundSatang: row.upperBoundSatang,
    settledCostSatang: row.settledCostSatang,
    monthKey: row.monthKey,
    createdAt: row.createdAt,
    dispatchedAt: row.dispatchedAt,
    invocationKeyShort: shortenInvocationKey(row.invocationKey),
  }));
}

/**
 * `<companyId>#<attemptHash>#<stepKind>#<ordinal>` shortened to something an operator can read out
 * loud and match against a log line, without shipping the full fence value to a browser. The
 * company segment is dropped (the page is already scoped to it) and the attempt hash is truncated.
 */
export function shortenInvocationKey(invocationKey: string): string {
  const parts = invocationKey.split('#');
  if (parts.length < 4) return invocationKey.slice(0, 24);
  const [, attempt, stepKind, ordinal] = parts as [string, string, string, string];
  return `${attempt.slice(0, 8)}…#${stepKind}#${ordinal}`;
}
