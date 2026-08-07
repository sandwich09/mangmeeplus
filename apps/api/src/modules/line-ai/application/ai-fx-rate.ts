/**
 * Live THB/USD resolution for the AI spend meter (metering spec §6.4, §7.4, owner revision
 * 2026-07-29). Bedrock bills in USD; the ledger is in satang, so every recording needs a rate —
 * and the rate it used is stamped on every row so the cost stays reproducible from the row alone.
 *
 * Plain functions with module-level state, the `company-ai-usage-meter.ts` budget-cache style.
 * Resolution NEVER throws and never blocks metering: the chain is
 * live cache → one fetch per TTL window → the stored `AiFxRate` row → `AI_THB_PER_USD`.
 */
import { Logger } from '@nestjs/common';
import type { AppConfigService } from '../../../common/config/app-config.service';
import type { PrismaService } from '../../../common/database/prisma.service';

const logger = new Logger('AiFxRate');

/** Keyless daily source; `rates.THB` is the only field read. */
const FX_URL = 'https://open.er-api.com/v6/latest/USD';
const FX_SOURCE_HOST = new URL(FX_URL).host;
const FX_FETCH_TIMEOUT_MS = 3_000;
/** Day-granularity is the honest precision for a monthly USD bill; ~6h keeps restarts cheap. */
const FX_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
/** A stored row older than a week means the source has been unreachable for a long time. */
const FX_STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
/** The single operational cache row (spec §7.3). */
const FX_ROW_ID = 'THB_USD';
/**
 * Sanity bound. THB/USD has traded in the 28–37 band for two decades; anything outside 20–60 is
 * a broken payload or a wrong base currency, never a real rate. An untrusted rate is treated as
 * a failed fetch — over- or under-pricing every row is worse than falling back.
 */
const FX_MIN = 20;
const FX_MAX = 60;
/**
 * Last resort when even `AI_THB_PER_USD` is missing — the stale-`packages/config`-dist trap would
 * otherwise make every `costSatang` NaN and silently stop the ledger. Same value as the config
 * default and the phase-6 migration backfill.
 */
const LAST_RESORT_THB_PER_USD = 33;

export type AiFxRateSource = 'live-cache' | 'fetched' | 'stored' | 'env-fallback';
export type ResolvedAiFxRate = { rate: number; source: AiFxRateSource };

type AiFxRateRow = { rate: unknown; fetchedAt: Date };
type AiFxRateDelegate = {
  findUnique(args: unknown): Promise<AiFxRateRow | null>;
  upsert(args: unknown): Promise<unknown>;
};

let cached: { rate: number; expiresAt: number } | null = null;
/** One outbound attempt per TTL window, success or not — a dead source must not cost 3s a call. */
let nextFetchAt = 0;

/** Test seam: both the TTL and the retry window are wall-clock. */
export function __resetFxCache(): void {
  cached = null;
  nextFetchAt = 0;
}

const trusted = (rate: number): boolean => Number.isFinite(rate) && rate >= FX_MIN && rate <= FX_MAX;

async function fetchThbPerUsd(): Promise<number | null> {
  try {
    const response = await fetch(FX_URL, { signal: AbortSignal.timeout(FX_FETCH_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = (await response.json()) as { rates?: { THB?: unknown } };
    const rate = Number(body?.rates?.THB);
    if (!trusted(rate)) {
      logger.warn({ msg: 'ai.fx.rejected', rate: body?.rates?.THB, min: FX_MIN, max: FX_MAX });
      return null;
    }
    return rate;
  } catch (err) {
    logger.warn({ msg: 'ai.fx.fetch_failed', error: (err as Error).message });
    return null;
  }
}

/**
 * Resolves the rate to price a recording at. Never throws — a metering-time FX failure must
 * degrade, not fail the user's already-completed AI action.
 */
export async function resolveThbPerUsd(
  prisma: PrismaService,
  config: AppConfigService,
): Promise<ResolvedAiFxRate> {
  const now = Date.now();
  if (cached && cached.expiresAt > now) return { rate: cached.rate, source: 'live-cache' };

  // Tolerant delegate, the `resolveCompanyAiModelPolicy` precedent: unit fakes predating the
  // table have no `aiFxRate`. Without somewhere to store a fetched rate there is also no reason
  // to make an outbound call from a test process, so this short-circuits to the env fallback.
  const repository = (prisma.client as any).aiFxRate as AiFxRateDelegate | undefined;
  if (!repository) return envFallback(config, false);

  let attempted = false;
  if (now >= nextFetchAt) {
    attempted = true;
    nextFetchAt = now + FX_CACHE_TTL_MS;
    const fetched = await fetchThbPerUsd();
    if (fetched !== null) {
      cached = { rate: fetched, expiresAt: now + FX_CACHE_TTL_MS };
      try {
        await repository.upsert({
          where: { id: FX_ROW_ID },
          create: { id: FX_ROW_ID, rate: fetched, source: FX_SOURCE_HOST, fetchedAt: new Date(now) },
          update: { rate: fetched, source: FX_SOURCE_HOST, fetchedAt: new Date(now) },
        });
      } catch (err) {
        // The rate is good and already cached; failing to persist it only costs the next restart.
        logger.warn({ msg: 'ai.fx.store_failed', error: (err as Error).message });
      }
      return { rate: fetched, source: 'fetched' };
    }
  }

  try {
    const row = await repository.findUnique({ where: { id: FX_ROW_ID }, select: { rate: true, fetchedAt: true } });
    if (row) {
      const rate = Number(row.rate);
      // Any age is better than no rate at all, but a week-old rate deserves a loud line.
      if (trusted(rate)) {
        if (now - new Date(row.fetchedAt).getTime() > FX_STALE_AFTER_MS) {
          logger.warn({ msg: 'ai.fx.stale_stored_rate', rate, fetchedAt: row.fetchedAt });
        }
        return { rate, source: 'stored' };
      }
      logger.warn({ msg: 'ai.fx.rejected_stored_rate', rate: row.rate, min: FX_MIN, max: FX_MAX });
    }
  } catch (err) {
    logger.warn({ msg: 'ai.fx.read_failed', error: (err as Error).message });
  }

  return envFallback(config, attempted);
}

/** `warn` only on the call that actually tried the source, i.e. once per TTL window. */
function envFallback(config: AppConfigService, warn: boolean): ResolvedAiFxRate {
  const configured = Number(config.aiThbPerUsd);
  const rate = Number.isFinite(configured) && configured > 0 ? configured : LAST_RESORT_THB_PER_USD;
  if (warn) logger.warn({ msg: 'ai.fx.env_fallback', rate });
  return { rate, source: 'env-fallback' };
}
