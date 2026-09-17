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
import { computeCostSatang } from './ai-model-pricing';

const logger = new Logger('CompanyAiUsageMeter');

export type CompanyAiUsageMeta = {
  companyId: string;
  sourceRoute: string;
  requestId?: string;
  /** Pinned when budget admission starts so lock, spend read and ledger write cannot straddle months. */
  monthKey?: string;
};

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
  | { allowed: true }
  | { allowed: false; reason: 'exceeded'; spendSatang: number; budgetSatang: number; override: boolean }
  | { allowed: false; reason: 'busy'; retryAfterSeconds: number }
  | { allowed: false; reason: 'unavailable' };

/**
 * The ONE place a money refusal becomes the typed code + scope every seam forwards (spec §9.1).
 * Before this each seam spelled the same ternary itself, which is how the LINE lanes ended up
 * throwing away the code and answering "temporarily unavailable" for an explicit budget decision.
 *
 * `budgetScope` is what this meter actually checked, never a guess: today it only ever reads the
 * company TOTAL, so TOTAL is the only truthful value. §12 adds the CHAT/OCR buckets and this
 * function is where they will be reported from — nothing downstream has to change again.
 */
export function companyAiBudgetRefusal(
  decision: Exclude<CompanyAiBudgetDecision, { allowed: true }>,
): { code: AiBudgetRefusalCode; budgetScope: AiBudgetScope; retryAfterSeconds?: number } {
  return {
    code: decision.reason === 'exceeded'
      ? AI_BUDGET_REFUSAL_CODES.exceeded
      : decision.reason === 'busy' ? AI_BUDGET_REFUSAL_CODES.busy : AI_BUDGET_REFUSAL_CODES.unavailable,
    budgetScope: 'TOTAL',
    ...(decision.reason === 'busy' ? { retryAfterSeconds: decision.retryAfterSeconds } : {}),
  };
}

type EffectiveBudget = { budgetSatang: number; override: boolean };

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
  if (!fresh && cached && cached.expiresAt > now) return { budgetSatang: cached.budgetSatang, override: cached.override };

  const repository = (prisma.client as any).companyAiConfiguration as
    | { findUnique(args: unknown): Promise<{ monthlyBudgetSatang: number | null } | null> }
    | undefined;
  // Same precedent as `resolveCompanyAiModelPolicy`: unit-test fakes predating the table omit
  // this delegate; the generated production client always exposes it. A *throwing* read is a
  // different thing and propagates to the caller's fail-closed handling.
  const row = repository ? await repository.findUnique({ where: { companyId }, select: { monthlyBudgetSatang: true } }) : null;
  const override = row?.monthlyBudgetSatang != null;
  const budgetSatang = override
    ? row!.monthlyBudgetSatang!
    : (await resolvePlatformAiBudget(prisma, config, fresh)).monthlyBudgetSatang;
  // A non-finite platform default means the config schema did not carry the key — a stale
  // `packages/config` dist is the known way that happens. Refuse loudly (the caller turns this
  // into `AI_BUDGET_UNAVAILABLE` plus a warn) rather than pass every call unmetered.
  if (!Number.isFinite(budgetSatang)) throw new Error('AI_MONTHLY_BUDGET_NOT_CONFIGURED');
  const resolved: EffectiveBudget = { budgetSatang, override };

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
  action: (monthKey: string) => Promise<T>,
  /** Optional admission lane (UAT 2026-08-27). A media turn makes model calls back-to-back for up
   *  to ~45s, so one combined lease made chat impossible while a photo processed — the poll gaps
   *  are milliseconds. A lane suffix gives chat and media their OWN single-flight lease. The
   *  monthly cap stays enforced: every admission re-reads the live aggregate after acquiring its
   *  lane, so the worst overshoot is ONE concurrent call per extra lane (~฿2), which the Owner
   *  accepted in exchange for "คุยระหว่างรูปได้จริง". Callers that pass no lane keep the exact
   *  legacy combined lease. */
  laneKey?: 'chat' | 'media',
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
    const budget = await assertCompanyAiBudget(prisma, config, companyId, monthKey);
    if (!budget.allowed) return budget;
    return { allowed: true, value: await action(monthKey) };
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
  if (!entries || entries.length === 0) {
    // Artifact/gateway version skew is the usual cause; visible, never fatal (criterion 10).
    logger.warn({
      msg: 'ai.usage.absent',
      sourceRoute: meta.sourceRoute,
      requestId: meta.requestId,
      companyId: meta.companyId,
    });
    return undefined;
  }

  const monthKey = meta.monthKey ?? bangkokMonthKey();
  // One resolution per recording, not per row: every row of this recording is priced at the same
  // rate and stamps it — plus where that rate came from, so a fallback leaves a mark on the row
  // and not only in a log line that rotates (spec §6.4 + addendum).
  const fx = await resolveThbPerUsd(prisma, config);
  const rows = entries.map((entry) => {
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
