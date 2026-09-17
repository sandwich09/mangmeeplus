/**
 * Per-company AI spend meter and monthly budget gate (metering spec §7.5).
 *
 * Plain functions in the `company-ai-model-policy.ts` style so the receipt, statement,
 * CRM and draft lanes can all import it cross-module. The budget helpers return decisions
 * rather than throwing, because each seam refuses in its own existing exhaustion shape
 * (HTTP 429, `{status:'failed'}`, or a provider-error result).
 */
import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { AI_BUDGET_REFUSAL_CODES, type AiBudgetRefusalCode, type AiBudgetScope, type AiUsageEntry } from '@watchdog-bms/contracts';
import type { AppConfigService } from '../../../common/config/app-config.service';
import type { PrismaService } from '../../../common/database/prisma.service';
import type { RedisRateLimitService } from '../../../common/security/redis-rate-limit.service';
import { SECURITY_EVENT, emitSecurityEvent } from '../../../common/logger/security-event';
import { resolveThbPerUsd } from './ai-fx-rate';
import { buildPricingSnapshot, computeCostSatang } from './ai-model-pricing';
import { resolveAiBudgetPolicy, type CompanyAiBudgetPolicyRow } from './company-ai-budget-policy';
import {
  markAiBudgetStepDispatched,
  reserveAiBudgetStep,
  settleAiBudgetStep,
  upsertBucketUsage,
  type ReservedAiBudgetStep,
} from './company-ai-budget-reservation';

const logger = new Logger('CompanyAiUsageMeter');

export type CompanyAiUsageMeta = {
  companyId: string;
  sourceRoute: string;
  requestId?: string;
  /** Pinned when budget admission starts so lock, spend read and ledger write cannot straddle months. */
  monthKey?: string;
  /** Server-derived, from {@link classifyAiUsageRequest}; absent = the row reports UNKNOWN. */
  requestKind?: AiRequestKind;
  budgetBucket?: AiBudgetBucket;
  /** SPLIT only: the invocation this response settles. Present => the reservation engine owns the
   *  write, so the same evidence can never be billed twice (ADR 0013 §7). */
  invocationKey?: string;
};

// ── Server-derived classification (remediation spec §12.2) ───────────────────

export type AiRequestKind = 'TEXT' | 'IMAGE' | 'OTHER';
export type AiBudgetBucket = 'CHAT' | 'OCR';
/** What the API put in the request it is about to send — never a model reading of it. */
export type AiRequestContent = 'text' | 'image' | 'document';

/** The two seams whose whole purpose is reading a document; both are OCR at any content type. */
const OCR_SOURCE_ROUTES = new Set(['receipt-ocr', 'bank-statement-extract']);
/** The one route whose bucket depends on the request: a picture puts it on the governed reader. */
const IMAGE_GATED_SOURCE_ROUTE = 'line-intake-route';

/**
 * Decides the budget bucket and request kind of an AI call BEFORE the provider runs, from what the
 * API itself assembled (spec §12.2). Never from model output, never from `usageTag.startsWith('ocr')`
 * — the intake image path is tagged `line.intake-route` — and never from user text.
 *
 * A LINE intake carrying a picture is OCR for the WHOLE call, even if the picture later turns out
 * not to be a receipt, because the route and the transcription happen in one provider call. A
 * `line-turn` stays CHAT even with an attachment: attaching an image must not move the turn's ERP
 * reasoning onto the document budget.
 */
export function classifyAiUsageRequest(
  sourceRoute: string,
  content: AiRequestContent,
): { requestKind: AiRequestKind; budgetBucket: AiBudgetBucket } {
  return {
    requestKind: content === 'image' ? 'IMAGE' : content === 'text' ? 'TEXT' : 'OTHER',
    budgetBucket:
      OCR_SOURCE_ROUTES.has(sourceRoute) || (sourceRoute === IMAGE_GATED_SOURCE_ROUTE && content !== 'text')
        ? 'OCR'
        : 'CHAT',
  };
}

/** The gateway response is untrusted wire JSON; only the two known values may reach the ledger.
 *  Exported as a PURE helper for the reservation engine's settlement writer — it stays the one
 *  place a `usageBasis` becomes a column value. */
export function normalizeUsageBasis(value: unknown): string | null {
  return value === 'PROVIDER_REPORTED' || value === 'CONSERVATIVE_ESTIMATE' ? value : null;
}

const nonNegativeCount = (value: unknown): boolean => Number.isSafeInteger(value) && (value as number) >= 0;
const presentString = (value: unknown): boolean => typeof value === 'string' && value !== '';

/**
 * The gateway's `usage` array is parsed wire JSON, not a validated payload. An entry whose four
 * counters are not non-negative safe integers is dropped BEFORE pricing: a negative or NaN counter
 * must never be able to lower a company's month aggregate or poison the whole batch's write.
 * `ok` is checked too, because a non-boolean would fail the insert for every sibling row.
 *
 * Exported as a PURE helper so settlement applies the identical guard: malformed evidence must
 * settle nothing and leave the hold, never move an aggregate.
 */
export function isMeterableEntry(entry: AiUsageEntry | undefined): boolean {
  return !!entry
    && presentString(entry.modelId) && presentString(entry.tag) && typeof entry.ok === 'boolean'
    && nonNegativeCount(entry.inputTokens) && nonNegativeCount(entry.outputTokens)
    && nonNegativeCount(entry.cacheReadInputTokens) && nonNegativeCount(entry.cacheWriteInputTokens);
}

/** Month-to-date spend either side of this recording, so phase 4 can detect a threshold
 *  crossing exactly once (the unique aggregate row serializes concurrent increments). */
export type CompanyAiUsageSpend = { pre: number; post: number };

/**
 * `YYYY-MM` in Asia/Bangkok (spec §6.5). Thailand has no DST, so a fixed +7h offset is
 * exact — no timezone dependency. Exported for the boundary tests.
 */
export function bangkokMonthKey(now: Date = new Date()): string {
  const shifted = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** The month key immediately before `bangkokMonthKey(now)` — the console's previous-month column. */
export function previousBangkokMonthKey(now: Date = new Date()): string {
  const [year, month] = bangkokMonthKey(now).split('-').map(Number);
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;
}

// ── Budget half (spec §7.5, assert) ──────────────────────────────────────────

/** Refusals carry the numbers the seam's event needs; `allowed` is the only branch a seam continues on. */
export type CompanyAiBudgetDecision =
  /** Under SPLIT the admitted action also carries the hold it runs inside (spec §12.3). */
  | { allowed: true; reservation?: ReservedAiBudgetStep }
  | { allowed: false; reason: 'exceeded'; spendSatang: number; budgetSatang: number; override: boolean; budgetScope?: AiBudgetScope }
  /** Money is LEFT but not enough for this step's declared bound — never "เต็ม" (spec §12.3). */
  | { allowed: false; reason: 'insufficient'; spendSatang: number; reservedSatang: number; budgetSatang: number; budgetScope: AiBudgetScope }
  | { allowed: false; reason: 'busy'; retryAfterSeconds: number }
  | { allowed: false; reason: 'unavailable'; budgetScope?: AiBudgetScope };

/**
 * The ONE place a money refusal becomes the typed code + scope every seam forwards (spec §9.1).
 * Before this each seam spelled the same ternary itself, which is how the LINE lanes ended up
 * throwing away the code and answering "temporarily unavailable" for an explicit budget decision.
 *
 * `budgetScope` is what this meter actually checked, never a guess. The SHARED path reads the
 * company TOTAL and says so; a SPLIT reservation reports the scope that actually blocked, which is
 * why the decision carries it rather than this function re-deriving it.
 */
export function companyAiBudgetRefusal(
  decision: Exclude<CompanyAiBudgetDecision, { allowed: true }>,
): { code: AiBudgetRefusalCode; budgetScope: AiBudgetScope; retryAfterSeconds?: number } {
  return {
    code: decision.reason === 'exceeded'
      ? AI_BUDGET_REFUSAL_CODES.exceeded
      : decision.reason === 'insufficient'
        ? AI_BUDGET_REFUSAL_CODES.insufficient
        : decision.reason === 'busy' ? AI_BUDGET_REFUSAL_CODES.busy : AI_BUDGET_REFUSAL_CODES.unavailable,
    budgetScope: (decision as { budgetScope?: AiBudgetScope }).budgetScope ?? 'TOTAL',
    ...(decision.reason === 'busy' ? { retryAfterSeconds: decision.retryAfterSeconds } : {}),
  };
}

/**
 * What a seam must be able to name before a SPLIT company may start a provider call (spec §12.6).
 * The bucket is server-derived by {@link classifyAiUsageRequest}; the attempt key is stable per
 * logical user attempt and carries no prompt text, raw LINE id or secret.
 */
export type CompanyAiBudgetStep = {
  stepKind: string;
  attemptKey: string;
  /** Named to match {@link classifyAiUsageRequest}'s result, so a seam spreads it in directly. */
  budgetBucket: AiBudgetBucket;
  sourceRoute: string;
  /** The company's approved model. A SPLIT company without one cannot pin an envelope: admission
   *  refuses `unavailable` rather than reserving against a model the gateway might not use. */
  modelId: string;
  /** Bounded call index inside the step kind; the API-side seam always starts an attempt at 0. */
  ordinal?: number;
  requestKind?: AiRequestKind;
  requestId?: string;
};

/**
 * The SPLIT half of admission: price the step's declared bound and hold it, or refuse with the
 * scope that actually blocked. Kept here rather than in the engine because this is where the
 * decision vocabulary every seam already understands is spoken.
 */
async function reserveCompanyAiBudgetStep(
  prisma: PrismaService,
  config: AppConfigService,
  companyId: string,
  monthKey: string,
  step: CompanyAiBudgetStep,
): Promise<CompanyAiBudgetDecision> {
  // OUTSIDE the transaction on purpose: resolving FX may make an outbound call, and no network may
  // happen while the company-month lock is held.
  const fx = await resolveThbPerUsd(prisma, config);
  const outcome = await reserveAiBudgetStep(prisma, config, {
    companyId, monthKey, bucket: step.budgetBucket, stepKind: step.stepKind, attemptKey: step.attemptKey,
    ordinal: step.ordinal ?? 0, sourceRoute: step.sourceRoute, modelId: step.modelId,
    thbPerUsd: fx.rate, thbPerUsdSource: fx.source,
  });
  if (outcome.ok) return { allowed: true, reservation: outcome.reservation };
  if (outcome.reason === 'exceeded') {
    emitSecurityEvent(logger, SECURITY_EVENT.aiCompanyBudgetExceeded, 'HIGH', {
      companyId, monthKey, budgetScope: outcome.budgetScope,
      spendSatang: outcome.spendSatang, budgetSatang: outcome.capSatang, override: outcome.override,
    });
    return { allowed: false, reason: 'exceeded', spendSatang: outcome.spendSatang,
      budgetSatang: outcome.capSatang, override: outcome.override, budgetScope: outcome.budgetScope };
  }
  if (outcome.reason === 'insufficient') {
    return { allowed: false, reason: 'insufficient', spendSatang: outcome.spendSatang,
      reservedSatang: outcome.reservedSatang, budgetSatang: outcome.capSatang, budgetScope: outcome.budgetScope };
  }
  if (outcome.reason === 'already_claimed') {
    // R-03: never a second execution. A hold another owner is still running is exactly the
    // transient `busy` the LINE lanes already retry; a terminal one cannot be re-run at all.
    logger.warn({ msg: 'ai.budget.invocation_already_claimed', companyId, monthKey, stepKind: step.stepKind, status: outcome.status });
    return outcome.status === 'RESERVED' || outcome.status === 'DISPATCHED'
      ? { allowed: false, reason: 'busy', retryAfterSeconds: 2 }
      : { allowed: false, reason: 'unavailable' };
  }
  logger.warn({ msg: 'ai.budget.reserve_unavailable', companyId, monthKey, stepKind: step.stepKind, reason: outcome.detail });
  return { allowed: false, reason: 'unavailable', budgetScope: outcome.budgetScope };
}

/** `policyRow` carries the split-policy columns as stored; resolving them needs a pinned month,
 *  so it happens at the call site and never inside this month-agnostic cache entry. */
type EffectiveBudget = { budgetSatang: number; override: boolean; policyRow?: CompanyAiBudgetPolicyRow };

/**
 * Configuration may be cached for non-admission observations; paid AI admission bypasses it.
 * Spend is always live. Same expiresAt-in-a-Map idiom as `RedisRateLimitService.localDecision`,
 * including the size-cap sweep, so a burst of tenants cannot grow this without bound.
 */
const BUDGET_CACHE_TTL_MS = 60_000;
const budgetCache = new Map<string, EffectiveBudget & { platform?: PlatformAiBudgetSettings; expiresAt: number }>();
const localBudgetAdmissions = new Map<string, { token: string; expiresAt: number }>();
const BUDGET_ADMISSION_SCOPE = 'ai-monthly-budget';
/** Longer than the longest outer AI Gateway timeout (120s); TTL only recovers a crashed owner. */
const BUDGET_ADMISSION_TTL_SECONDS = 180;

/** The platform row rides in the same cache under a key no company id can collide with. */
const PLATFORM_CACHE_KEY = '__platform__';
/** Single-row table (spec §7.3). */
const PLATFORM_CONFIG_ID = 'platform';

/** Test seam: the TTL is wall-clock, so specs need a deterministic way back to a cold cache. */
export function __resetCompanyAiBudgetCache(): void {
  invalidateCompanyAiBudgetConfiguration();
  localBudgetAdmissions.clear();
}

/** Production setting changes must not release an in-flight admission. */
export function invalidateCompanyAiBudgetConfiguration(): void { budgetCache.clear(); }

/** Platform-wide defaults, DB row first and the env values as the fallback (spec §7.4). */
export type PlatformAiBudgetSettings = {
  monthlyBudgetSatang: number;
  ceilingSatang: number;
  monthlyBudgetSource: 'db' | 'env';
  ceilingSource: 'db' | 'env';
};

/**
 * Non-admission observations may share a 60s cache. Admission and Admin reads explicitly request
 * fresh settings so a change on another API instance is visible before starting new work.
 */
export async function resolvePlatformAiBudget(
  prisma: PrismaService,
  config: AppConfigService,
  fresh = false,
): Promise<PlatformAiBudgetSettings> {
  const now = Date.now();
  const cached = budgetCache.get(PLATFORM_CACHE_KEY);
  if (!fresh && cached?.platform && cached.expiresAt > now) return cached.platform;

  // Tolerant delegate (the `resolveCompanyAiModelPolicy` precedent for unit fakes predating the
  // table); a *throwing* read still propagates into the caller's fail-closed handling.
  const repository = (prisma.client as any).platformAiBudgetConfig as
    | { findUnique(args: unknown): Promise<{ monthlyBudgetSatang: number; ceilingSatang: number } | null> }
    | undefined;
  const row = repository
    ? await repository.findUnique({
        where: { id: PLATFORM_CONFIG_ID },
        select: { monthlyBudgetSatang: true, ceilingSatang: true },
      })
    : null;

  const resolved: PlatformAiBudgetSettings = {
    monthlyBudgetSatang: row?.monthlyBudgetSatang ?? config.aiMonthlyBudgetSatang,
    ceilingSatang: row?.ceilingSatang ?? config.aiMonthlyBudgetSatangCeiling,
    monthlyBudgetSource: row ? 'db' : 'env',
    ceilingSource: row ? 'db' : 'env',
  };
  budgetCache.set(PLATFORM_CACHE_KEY, {
    budgetSatang: resolved.monthlyBudgetSatang,
    override: false,
    platform: resolved,
    expiresAt: now + BUDGET_CACHE_TTL_MS,
  });
  return resolved;
}

async function resolveEffectiveBudget(
  prisma: PrismaService,
  config: AppConfigService,
  companyId: string,
  fresh = false,
): Promise<EffectiveBudget> {
  const now = Date.now();
  const cached = budgetCache.get(companyId);
  if (!fresh && cached && cached.expiresAt > now) {
    return { budgetSatang: cached.budgetSatang, override: cached.override, policyRow: cached.policyRow };
  }

  const repository = (prisma.client as any).companyAiConfiguration as
    | { findUnique(args: unknown): Promise<({ monthlyBudgetSatang: number | null } & CompanyAiBudgetPolicyRow) | null> }
    | undefined;
  // Same precedent as `resolveCompanyAiModelPolicy`: unit-test fakes predating the table omit
  // this delegate; the generated production client always exposes it. A *throwing* read is a
  // different thing and propagates to the caller's fail-closed handling.
  // ONE select — the split-policy columns ride along with the total (spec §12.1), never a second query.
  const row = repository ? await repository.findUnique({
    where: { companyId },
    select: {
      monthlyBudgetSatang: true, budgetMode: true, chatMonthlyBudgetSatang: true,
      ocrMonthlyBudgetSatang: true, budgetConfigVersion: true, pendingBudgetPolicy: true,
    },
  }) : null;
  const override = row?.monthlyBudgetSatang != null;
  const budgetSatang = override
    ? row!.monthlyBudgetSatang!
    : (await resolvePlatformAiBudget(prisma, config, fresh)).monthlyBudgetSatang;
  // A non-finite platform default means the config schema did not carry the key — a stale
  // `packages/config` dist is the known way that happens. Refuse loudly (the caller turns this
  // into `AI_BUDGET_UNAVAILABLE` plus a warn) rather than pass every call unmetered.
  if (!Number.isFinite(budgetSatang)) throw new Error('AI_MONTHLY_BUDGET_NOT_CONFIGURED');
  const resolved: EffectiveBudget = { budgetSatang, override, policyRow: row ?? {} };

  if (budgetCache.size > 10_000) {
    for (const [candidate, entry] of budgetCache) {
      if (entry.expiresAt <= now) budgetCache.delete(candidate);
    }
    const oldest = budgetCache.keys().next().value as string | undefined;
    if (budgetCache.size > 10_000 && oldest) budgetCache.delete(oldest);
  }
  budgetCache.set(companyId, { ...resolved, expiresAt: now + BUDGET_CACHE_TTL_MS });
  return resolved;
}

/**
 * Live spend check (spec §6.6): is the company already at or over its effective monthly budget?
 * Cost-bearing callers invoke this only after `runWithCompanyAiBudgetAdmission` owns the
 * company/month lease; direct exports remain useful to admin and event tests.
 *
 * Never throws. Any read failure returns `unavailable` (spec §6.7): an unreadable meter must
 * refuse with a distinct code, never become an unmetered pass.
 */
export async function assertCompanyAiBudget(
  prisma: PrismaService,
  config: AppConfigService,
  companyId: string,
  monthKey: string = bangkokMonthKey(),
  /** Supplied only by a seam that can name the step it is about to run (spec §12.6). Without it a
   *  SPLIT company keeps refusing: production must never fall back to an unmetered pass (F-07). */
  step?: CompanyAiBudgetStep,
): Promise<CompanyAiBudgetDecision> {
  let budget: EffectiveBudget;
  let spendSatang: number;
  try {
    // A different API instance may have changed the cap; cached configuration cannot authorize spend.
    budget = await resolveEffectiveBudget(prisma, config, companyId, true);
    // Live point read on the unique aggregate: spend is the one value that must not be stale.
    const row = await (prisma.client as any).companyAiMonthlyUsage.findUnique({
      where: { companyId_monthKey: { companyId, monthKey } },
      select: { costSatang: true },
    });
    spendSatang = row?.costSatang ?? 0; // no aggregate row yet = nothing spent this month
  } catch (err) {
    logger.warn({ msg: 'ai.budget.read_failed', companyId, error: (err as Error).message });
    return { allowed: false, reason: 'unavailable' };
  }

  // Split policy gate (spec §12.1, ADR 0013 §5). SHARED — every company today — falls straight
  // through to the legacy comparison below. A policy we cannot read, and a SPLIT policy, refuse:
  // this bounded-overshoot path cannot honour a per-bucket cap, and the reservation engine that
  // can only arrives in the next phase. Nothing is clamped and no amounts beyond the existing
  // exceeded event are logged.
  const policy = resolveAiBudgetPolicy({
    row: budget.policyRow, totalSatang: budget.budgetSatang, override: budget.override, monthKey,
  });
  if (policy.invalidReason || (policy.mode === 'SPLIT' && !step)) {
    logger.warn({
      msg: 'ai.budget.policy_unavailable',
      companyId,
      monthKey,
      reason: policy.invalidReason ?? 'split_step_not_declared',
    });
    return { allowed: false, reason: 'unavailable' };
  }
  // SPLIT: the bounded-overshoot comparison below cannot honour a per-bucket cap, so admission
  // moves to the reservation engine — one durable hold per provider invocation, priced from the
  // step's declared bound (spec §12.3). SHARED falls straight through, byte-for-byte as before.
  if (policy.mode === 'SPLIT') return reserveCompanyAiBudgetStep(prisma, config, companyId, monthKey, step!);

  if (spendSatang >= budget.budgetSatang) {
    emitSecurityEvent(logger, SECURITY_EVENT.aiCompanyBudgetExceeded, 'HIGH', {
      companyId,
      spendSatang,
      budgetSatang: budget.budgetSatang,
      override: budget.override,
    });
    return { allowed: false, reason: 'exceeded', spendSatang, budgetSatang: budget.budgetSatang, override: budget.override };
  }
  return { allowed: true };
}

/**
 * Serializes cost-bearing actions per company/month across API instances, re-checks the live
 * aggregate only after admission, and holds the lease until `action` has recorded its usage.
 * Therefore concurrent callers cannot all pass the same stale check; at most the one admitted
 * action can cross the cap because its exact provider cost is only known after it finishes.
 */
export async function runWithCompanyAiBudgetAdmission<T>(
  prisma: PrismaService,
  config: AppConfigService,
  rateLimits: RedisRateLimitService | undefined,
  companyId: string,
  action: (monthKey: string, hold?: ReservedAiBudgetStep) => Promise<T>,
  /** Optional admission lane (UAT 2026-08-27). A media turn makes model calls back-to-back for up
   *  to ~45s, so one combined lease made chat impossible while a photo processed — the poll gaps
   *  are milliseconds. A lane suffix gives chat and media their OWN single-flight lease. The
   *  monthly cap stays enforced: every admission re-reads the live aggregate after acquiring its
   *  lane, so the worst overshoot is ONE concurrent call per extra lane (~฿2), which the Owner
   *  accepted in exchange for "คุยระหว่างรูปได้จริง". Callers that pass no lane keep the exact
   *  legacy combined lease. */
  laneKey?: 'chat' | 'media',
  /** SPLIT admission needs the step a seam is about to run. Absent = today's SHARED-only path. */
  step?: CompanyAiBudgetStep,
): Promise<({ allowed: true; value: T } | Exclude<CompanyAiBudgetDecision, { allowed: true }>)> {
  const monthKey = bangkokMonthKey();
  const leaseKey = `${companyId}:${monthKey}${laneKey ? `:${laneKey}` : ''}`;
  let token: string;
  let shared = false;

  if (rateLimits && typeof (rateLimits as any).tryAcquireLease === 'function') {
    try {
      const lease = await rateLimits.tryAcquireLease(BUDGET_ADMISSION_SCOPE, leaseKey, BUDGET_ADMISSION_TTL_SECONDS);
      if (!lease.acquired) return { allowed: false, reason: 'busy', retryAfterSeconds: lease.retryAfterSeconds };
      token = lease.token;
      shared = true;
    } catch (err) {
      logger.warn({ msg: 'ai.budget.admission_failed', companyId, error: (err as Error).message });
      return { allowed: false, reason: 'unavailable' };
    }
  } else {
    // Production must never silently fall back to a per-process lock if DI/store wiring is lost.
    if (config.isProduction) {
      logger.warn({ msg: 'ai.budget.admission_missing', companyId });
      return { allowed: false, reason: 'unavailable' };
    }
    const now = Date.now();
    const current = localBudgetAdmissions.get(leaseKey);
    if (current && current.expiresAt > now) {
      return { allowed: false, reason: 'busy', retryAfterSeconds: Math.max(1, Math.ceil((current.expiresAt - now) / 1_000)) };
    }
    token = randomUUID();
    localBudgetAdmissions.set(leaseKey, { token, expiresAt: now + BUDGET_ADMISSION_TTL_SECONDS * 1_000 });
  }

  try {
    const budget = await assertCompanyAiBudget(prisma, config, companyId, monthKey, step);
    if (!budget.allowed) return budget;
    // SHARED keeps the exact legacy path: no reservation, no envelope, no dispatch mark.
    if (!budget.reservation) return { allowed: true, value: await action(monthKey) };
    // The DISPATCHED mark is durably committed BEFORE the seam's HTTP call, which is what makes a
    // stale `RESERVED` row provable evidence that no provider ever started (ADR 0013 §6).
    if (!await markAiBudgetStepDispatched(prisma, budget.reservation.id, budget.reservation.ownerToken)) {
      logger.warn({ msg: 'ai.budget.dispatch_lost', companyId, monthKey, stepKind: budget.reservation.stepKind });
      return { allowed: false, reason: 'unavailable' };
    }
    return { allowed: true, value: await action(monthKey, budget.reservation) };
  } finally {
    if (shared) {
      try {
        await rateLimits!.releaseLease(BUDGET_ADMISSION_SCOPE, leaseKey, token!);
      } catch (err) {
        // The TTL is the final safety net; never turn a completed business action into a failure.
        logger.warn({ msg: 'ai.budget.admission_release_failed', companyId, error: (err as Error).message });
      }
    } else if (localBudgetAdmissions.get(leaseKey)?.token === token!) {
      localBudgetAdmissions.delete(leaseKey);
    }
  }
}

/** How often a waiting caller re-attempts the single-flight admission. The lease is released
 *  between a turn's model calls, so short polls catch those gaps without hammering the store. */
const BUSY_ADMISSION_POLL_MS = 1_200;

/**
 * Bounded retry around a busy admission (UAT 2026-08-27). The per-company single-flight lease
 * exists for budget accounting, but on the LIVE chat path an instant `busy` failure blocks the
 * user mid-conversation: a photo turn holds the lease through its model calls, so "คุยระหว่างนี้ได้"
 * was impossible. A live caller passes a deadline and only the `busy` outcome is retried until
 * then; every other outcome (allowed, exceeded, unavailable) returns immediately. Callers without
 * a deadline keep the exact fail-fast behavior — the ledger drain relies on it.
 */
export async function retryBusyAdmission<D>(
  attempt: () => Promise<D>,
  busyWaitDeadlineMs: number | undefined,
  sleepFn: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<D> {
  for (;;) {
    const decision = await attempt();
    const busy = (decision as { allowed?: unknown }).allowed === false
      && (decision as { reason?: unknown }).reason === 'busy';
    const remainingMs = busyWaitDeadlineMs === undefined ? 0 : busyWaitDeadlineMs - Date.now();
    if (!busy || remainingMs <= 0) return decision;
    await sleepFn(Math.min(BUSY_ADMISSION_POLL_MS, remainingMs));
  }
}

/**
 * Writes one `AiUsageEvent` per reported model call and increments the monthly aggregate,
 * both inside ONE interactive transaction. The upsert is scalar-only against the unique
 * `[companyId, monthKey]`, so it compiles to a native `INSERT ... ON CONFLICT DO UPDATE` —
 * never a create-then-catch-P2002, which would poison the surrounding transaction (25P02).
 *
 * MAY THROW. Callers await it inside try/catch and warn: a metering failure must never
 * fail the user's already-completed AI action (spec §6.7).
 */
export async function recordCompanyAiUsage(
  prisma: PrismaService,
  config: AppConfigService,
  meta: CompanyAiUsageMeta,
  entries: AiUsageEntry[] | undefined,
): Promise<CompanyAiUsageSpend | undefined> {
  // Trust boundary: drop what cannot be priced, keep the rest. Counts and ids only in the warn —
  // never the entry itself, which came off the wire (PDPA posture).
  const priceable = (entries ?? []).filter((entry) => {
    if (isMeterableEntry(entry)) return true;
    logger.warn({
      msg: 'ai.usage.malformed_entry',
      sourceRoute: meta.sourceRoute,
      requestId: meta.requestId,
      companyId: meta.companyId,
    });
    return false;
  });

  if (priceable.length === 0) {
    // Artifact/gateway version skew is the usual cause; visible, never fatal (criterion 10).
    logger.warn({
      msg: 'ai.usage.absent',
      sourceRoute: meta.sourceRoute,
      requestId: meta.requestId,
      companyId: meta.companyId,
    });
    return undefined;
  }

  // SPLIT: the reservation engine owns the write for the enveloped invocation, so the hold is
  // released by the SAME transaction that records the money and the fence makes a replay a no-op.
  // A multi-call chain returns more entries than the one invocation this seam enveloped; until
  // E1c has the gateway settle each of its own calls, the remainder is metered through the normal
  // path below (never dropped — that would turn real provider spend into zero).
  if (meta.invocationKey) {
    const [first, ...rest] = priceable;
    const settled = await settleAiBudgetStep(prisma, {
      invocationKey: meta.invocationKey,
      entry: first!,
      meta: { sourceRoute: meta.sourceRoute, requestId: meta.requestId, requestKind: meta.requestKind },
    });
    if (settled !== 'settled' && settled !== 'duplicate') {
      logger.warn({ msg: 'ai.budget.settle_rejected', companyId: meta.companyId, sourceRoute: meta.sourceRoute, result: settled });
    }
    if (rest.length === 0) return undefined;
    logger.warn({ msg: 'ai.budget.unenveloped_chain_usage', companyId: meta.companyId, sourceRoute: meta.sourceRoute, entries: rest.length });
    return recordCompanyAiUsage(prisma, config, { ...meta, invocationKey: undefined }, rest);
  }

  const monthKey = meta.monthKey ?? bangkokMonthKey();
  // One resolution per recording, not per row: every row of this recording is priced at the same
  // rate and stamps it — plus where that rate came from, so a fallback leaves a mark on the row
  // and not only in a log line that rotates (spec §6.4 + addendum).
  const fx = await resolveThbPerUsd(prisma, config);
  const rows = priceable.map((entry) => {
    const { costSatang, unknownModel } = computeCostSatang(entry, fx.rate);
    if (unknownModel) {
      logger.warn({
        msg: 'ai.usage.unknown_model_price',
        modelId: entry.modelId,
        sourceRoute: meta.sourceRoute,
        requestId: meta.requestId,
        companyId: meta.companyId,
      });
    }
    return {
      companyId: meta.companyId,
      monthKey,
      sourceRoute: meta.sourceRoute,
      usageTag: entry.tag,
      modelId: entry.modelId,
      ok: entry.ok,
      inputTokens: entry.inputTokens,
      outputTokens: entry.outputTokens,
      cacheReadInputTokens: entry.cacheReadInputTokens,
      cacheWriteInputTokens: entry.cacheWriteInputTokens,
      costSatang,
      thbPerUsd: fx.rate, // Prisma Decimal accepts a JS number
      thbPerUsdSource: fx.source,
      requestId: meta.requestId,
      // D1 metadata (spec §11.2). `null` where the seam or the gateway did not report one, so the
      // console says UNKNOWN instead of inferring a bucket from a tag or a peer row.
      requestKind: meta.requestKind ?? null,
      budgetBucket: meta.budgetBucket ?? null,
      usageBasis: normalizeUsageBasis((entry as { usageBasis?: unknown }).usageBasis),
      eventKind: 'MODEL_CALL',
      pricingSnapshot: buildPricingSnapshot(entry, fx.rate, costSatang),
    };
  });

  const delta = rows.reduce(
    (acc, row) => ({
      costSatang: acc.costSatang + row.costSatang,
      inputTokens: acc.inputTokens + row.inputTokens,
      outputTokens: acc.outputTokens + row.outputTokens,
      cacheReadInputTokens: acc.cacheReadInputTokens + row.cacheReadInputTokens,
      cacheWriteInputTokens: acc.cacheWriteInputTokens + row.cacheWriteInputTokens,
    }),
    { costSatang: 0, inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheWriteInputTokens: 0 },
  );

  const post = await prisma.client.$transaction(async (tx: any) => {
    await tx.aiUsageEvent.createMany({ data: rows });
    // Bucket slice in the SAME transaction, SHARED companies included (ADR 0013 §3): a later SPLIT
    // activation and the admin console then read one aggregate instead of re-deriving bucket spend.
    // An unknown bucket belongs to neither — it still counts against the total and is never guessed.
    if (meta.budgetBucket) {
      await upsertBucketUsage(tx, meta.companyId, monthKey, meta.budgetBucket, delta.costSatang, rows.length);
    }
    return tx.companyAiMonthlyUsage.upsert({
      where: { companyId_monthKey: { companyId: meta.companyId, monthKey } },
      create: { companyId: meta.companyId, monthKey, callCount: rows.length, ...delta },
      update: {
        costSatang: { increment: delta.costSatang },
        callCount: { increment: rows.length },
        inputTokens: { increment: delta.inputTokens },
        outputTokens: { increment: delta.outputTokens },
        cacheReadInputTokens: { increment: delta.cacheReadInputTokens },
        cacheWriteInputTokens: { increment: delta.cacheWriteInputTokens },
      },
      select: { costSatang: true },
    });
  });

  const spend = { pre: post.costSatang - delta.costSatang, post: post.costSatang };

  // 80% crossing, exactly once per company-month: the unique aggregate row serializes
  // increments, so exactly one recording sees `pre` below the line and `post` at or past it.
  // Best effort — the spend is already durably recorded, and a failed alert must not turn into
  // an `ai.usage.record_failed` warn at the caller.
  try {
    const budget = await resolveEffectiveBudget(prisma, config, meta.companyId);
    const threshold = budget.budgetSatang * 0.8;
    if (spend.pre < threshold && spend.post >= threshold) {
      emitSecurityEvent(logger, SECURITY_EVENT.aiCompanyBudgetThreshold, 'HIGH', {
        companyId: meta.companyId,
        spendSatang: spend.post,
        budgetSatang: budget.budgetSatang,
        override: budget.override,
      });
    }
  } catch (err) {
    logger.warn({ msg: 'ai.budget.threshold_check_failed', companyId: meta.companyId, error: (err as Error).message });
  }

  return spend;
}

/** Signed deltas against one already-recorded MODEL_CALL row (spec §11.2). Omitted counters are 0. */
export type CompanyAiCostAdjustment = {
  /** The `AiUsageEvent.id` whose evidence changed. */
  eventId: string;
  /** Replay fence: the same identity applied twice is a no-op, never a second correction. */
  correctionKey: string;
  costSatang: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadInputTokens?: number;
  cacheWriteInputTokens?: number;
};

/**
 * True only for a unique violation on `AiUsageEvent.correctionKey`. Prisma 7's pg driver adapter
 * leaves `meta.target` undefined and reports the column through the driver-adapter cause, QUOTED
 * (`"correctionKey"`) — verified against real PostgreSQL, not assumed. The legacy `meta.target`
 * and a constraint/index NAME are accepted too, because which of the three a given adapter fills
 * in is not something this module should depend on. Anything else is a real failure and keeps
 * propagating.
 */
function isCorrectionKeyConflict(error: unknown): boolean {
  const err = error as { code?: unknown; meta?: Record<string, any> } | null;
  if (err?.code !== 'P2002') return false;
  const constraint = err.meta?.['driverAdapterError']?.cause?.constraint;
  const fields = constraint?.fields ?? err.meta?.['target'];
  if ((Array.isArray(fields) ? fields : [fields])
    .some((field) => typeof field === 'string' && field.replace(/"/g, '') === 'correctionKey')) return true;
  const name = typeof constraint === 'string' ? constraint : constraint?.index ?? constraint?.name;
  return typeof name === 'string' && name.includes('correctionKey');
}

/**
 * Appends an audited `COST_ADJUSTMENT` row and moves the ORIGINAL row's month aggregate by the same
 * signed deltas, in one transaction. It is never a provider call: `callCount` is untouched, so
 * averages and `topTags.calls` keep counting model calls only.
 *
 * Phase E settles late actuals through this; there is deliberately no HTTP endpoint and no caller
 * yet, so a public API cannot post adjustments. The aggregate move is a single conditional
 * `updateMany` — it refuses atomically rather than read-then-write, so no total can go negative
 * and no isolation level is required.
 */
export async function recordCompanyAiCostAdjustment(
  prisma: PrismaService,
  adjustment: CompanyAiCostAdjustment,
): Promise<'applied' | 'duplicate' | 'unknown-event' | 'refused-negative'> {
  const delta = {
    costSatang: adjustment.costSatang,
    inputTokens: adjustment.inputTokens ?? 0,
    outputTokens: adjustment.outputTokens ?? 0,
    cacheReadInputTokens: adjustment.cacheReadInputTokens ?? 0,
    cacheWriteInputTokens: adjustment.cacheWriteInputTokens ?? 0,
  };
  try {
    return await applyCompanyAiCostAdjustment(prisma, adjustment, delta);
  } catch (err) {
    // Concurrency: two callers can both pass the `findUnique` below, and the loser's INSERT hits
    // the unique index. Its WHOLE transaction — including the aggregate move — is rolled back, so
    // the observable outcome is exactly the fast-path replay: the correction applied once.
    if (isCorrectionKeyConflict(err)) return 'duplicate';
    throw err;
  }
}

function applyCompanyAiCostAdjustment(
  prisma: PrismaService,
  adjustment: CompanyAiCostAdjustment,
  delta: Record<string, number>,
): Promise<'applied' | 'duplicate' | 'unknown-event' | 'refused-negative'> {
  return prisma.client.$transaction(async (tx: any) => {
    const replay = await tx.aiUsageEvent.findUnique({ where: { correctionKey: adjustment.correctionKey }, select: { id: true } });
    if (replay) return 'duplicate';
    const original = await tx.aiUsageEvent.findUnique({
      where: { id: adjustment.eventId },
      select: {
        companyId: true, monthKey: true, sourceRoute: true, usageTag: true, modelId: true,
        thbPerUsd: true, thbPerUsdSource: true, requestKind: true, budgetBucket: true,
        usageBasis: true, requestId: true, eventKind: true,
      },
    });
    if (!original || original.eventKind !== 'MODEL_CALL') return 'unknown-event';
    const { eventKind: _eventKind, ...carried } = original;
    // Guard inside the WHERE: a negative delta may only apply while every total stays >= 0.
    const moved = await tx.companyAiMonthlyUsage.updateMany({
      where: {
        companyId: original.companyId,
        monthKey: original.monthKey,
        ...Object.fromEntries(Object.entries(delta).map(([field, value]) => [field, { gte: -value }])),
      },
      data: Object.fromEntries(Object.entries(delta).map(([field, value]) => [field, { increment: value }])),
    });
    if (moved.count === 0) return 'refused-negative';
    // The bucket aggregate moves with the SAME guard, so no bucket total can go negative either.
    // A row whose bucket is UNKNOWN has no bucket aggregate to move — the total above is the whole
    // correction for it, exactly as it was the whole charge.
    if (original.budgetBucket) {
      const bucketDelta = delta['costSatang']!;
      if (bucketDelta >= 0) {
        // A legacy row predating the bucket aggregate has no row yet; a positive correction opens it.
        await upsertBucketUsage(tx, original.companyId, original.monthKey, original.budgetBucket, bucketDelta, 0);
      } else if (tx.companyAiMonthlyBucketUsage) {
        const bucketMoved = await tx.companyAiMonthlyBucketUsage.updateMany({
          where: {
            companyId: original.companyId, monthKey: original.monthKey, bucket: original.budgetBucket,
            costSatang: { gte: -bucketDelta },
          },
          data: { costSatang: { increment: bucketDelta } },
        });
        if (bucketMoved.count === 0) return 'refused-negative';
      }
    }
    await tx.aiUsageEvent.create({
      data: {
        ...carried, ...delta, ok: true, eventKind: 'COST_ADJUSTMENT',
        adjustsEventId: adjustment.eventId, correctionKey: adjustment.correctionKey, pricingSnapshot: null,
      },
    });
    return 'applied';
  });
}
