/**
 * SHADOW availability probe (plan §3 F1: "Deploy gate reads/stamps in shadow … then atomically flip
 * enforcement", plan §8 item 2).
 *
 * It computes what the CC1 guard WOULD decide and records it. It never throws, never blocks and
 * never writes an `ExecutionAttempt` row — F1 ends before the enforcement flip, so an async surface
 * that is entitlement-blind today stays exactly as blind, only now it is measured. The counter it
 * produces is the `would_block` signal plan §8 item 4 requires before any route opens under
 * enforcement.
 *
 * That counter is now DURABLE (r2 ruling): `flush()` folds the sweep into hourly
 * `FeatureLaunchObservationBucket` rows, because a flip is approved from would-block evidence and
 * log-only evidence evaporates with the log retention window. The buckets carry no companyId and no
 * PII — see the model comment in `schema.prisma`.
 *
 * Load shape is the guard's, not a cache: one entitlement read per company per sweep and one gate
 * read per sweep. Memoization is planning-only (spec:60) — it is sound here precisely BECAUSE the
 * result is never used as a fence. The real fence is `ExecutionAttemptService.claimAttempt`, whose
 * read is uncached and inside the claim transaction.
 */
import { Inject, Injectable } from '@nestjs/common';
import { resolveDeploymentIdentity, type DeploymentIdentity } from '@watchdog-bms/config';
import { PrismaService } from '../../../common/database/prisma.service';
import { LOGGER_TOKEN, type AppLogger } from '../../../common/logger/logger.service';

export const LAUNCH_SHADOW_EVENT = 'launch.shadow.would_block';
/** A persist failure is visible and never fatal: the drain it measures must not care. */
export const LAUNCH_SHADOW_PERSIST_FAILED_EVENT = `${LAUNCH_SHADOW_EVENT}.persist_failed`;
/**
 * An entitlement/gate READ failed, so this observation was never taken. Distinct from
 * `persist_failed`, which means the observation WAS taken and could not be stored — an operator
 * triaging a hole in `hoursObserved` needs to know which of the two happened.
 */
export const LAUNCH_SHADOW_READ_FAILED_EVENT = `${LAUNCH_SHADOW_EVENT}.read_failed`;

export type ShadowReason =
  | 'available'
  | 'feature_disabled'
  | 'launch_gate_closed'
  | 'unmapped_feature'
  | 'no_company'
  /**
   * The gate/entitlement read threw. NEVER persisted and never counted — a failed read is not
   * evidence, and a bucket row claiming otherwise would let R1 read an outage as a clean window.
   * It exists only so `record()` can keep its return type while telling a caller (which ignores it)
   * that nothing was measured.
   */
  | 'read_failed';

/**
 * The ONE reason→block mapping, exported so the health view derives nothing of its own. A stored
 * bucket also carries the boolean, so evidence written by an older build is never reinterpreted by
 * a newer one that changed this set.
 */
export const SHADOW_BLOCKING_REASONS: ReadonlySet<ShadowReason> = new Set<ShadowReason>([
  'feature_disabled',
  'launch_gate_closed',
]);

/**
 * `gateKey` for an observation whose owning feature is not mapped yet. NOT NULL with a sentinel
 * rather than a nullable column: Postgres treats NULLs in a unique index as DISTINCT, which would
 * silently disable the bucket key for exactly these rows (same reasoning as
 * `ExecutionAttempt.companyScope = '__platform__'`).
 */
export const UNMAPPED_GATE_KEY = '__unmapped__';

export const SHADOW_BUCKET_HOUR_MS = 3_600_000;
/** UTC hour floor. One helper, so the writer and the health view's window agree by construction. */
export const shadowBucketHour = (at: number | Date = Date.now()): Date =>
  new Date(Math.floor((at instanceof Date ? at.getTime() : at) / SHADOW_BUCKET_HOUR_MS) * SHADOW_BUCKET_HOUR_MS);

export type ShadowDecision = { wouldBlock: boolean; reason: ShadowReason };

@Injectable()
export class LaunchShadowProbe {
  /**
   * Read once per process, exactly as `LaunchGateGuardService` does. Not injected: keeping the
   * constructor at (prisma, logger) means no module wiring and no DI shape change for a value that
   * is a pure function of the environment.
   */
  private readonly deployment: DeploymentIdentity = resolveDeploymentIdentity(process.env);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(LOGGER_TOKEN) private readonly logger: AppLogger,
  ) {}

  /** One sweep = one scanner/drain pass. Its memoized reads live and die with the sweep. */
  startSweep(surface: string): LaunchShadowSweep {
    return new LaunchShadowSweep(this.prisma, this.logger, surface, this.deployment);
  }
}

/**
 * Driver/runtime error codes are short stable identifiers (`P2002`, `ECONNREFUSED`, `23505`), never
 * free text. The pattern is a conservative gate: anything with whitespace, punctuation or length
 * beyond a code is treated as a message and dropped, so a library that stuffs a sentence into
 * `.code` cannot smuggle a tenant value through this field.
 */
const STABLE_ERROR_CODE = /^[A-Za-z0-9_]{1,32}$/;

/**
 * Tenant-free description of a thrown value: its class, plus a driver code when one is present.
 * NEVER `err.message` and never the error object — see `warnSafely`.
 */
export function errorCategory(err: unknown): { errorCategory: string; errorCode?: string } {
  if (typeof err !== 'object' || err === null) return { errorCategory: typeof err };
  const category = err.constructor?.name ?? 'Object';
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' && STABLE_ERROR_CODE.test(code)
    ? { errorCategory: category, errorCode: code }
    : { errorCategory: category };
}

/** One in-memory bucket: the sweep's share of exactly one durable row. */
type SweepBucket = { gateKey: string; routeKey: string; reason: ShadowReason; wouldBlock: boolean; count: number };

export class LaunchShadowSweep {
  private gates: Map<string, { state: string; generation: number }> | null = null;
  private readonly entitlementsByCompany = new Map<string, Map<string, boolean> | null>();
  /**
   * Keyed by (gate, route, reason) rather than by reason alone: the durable row is per exact route,
   * because R1 asks whether THIS route would have blocked, not whether anything would have.
   */
  private readonly buckets = new Map<string, SweepBucket>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: AppLogger,
    private readonly surface: string,
    private readonly deployment: DeploymentIdentity,
  ) {}

  /**
   * Records the shadow decision for one item and returns it. Callers PROCEED regardless — a
   * caller that branches on this result has flipped enforcement, which F1 does not do.
   *
   * NEVER THROWS. The probe's whole contract is that a surface which is entitlement-blind today
   * stays exactly as blind, only measured — so a launch-table read that fails must not be able to
   * stop a notification delivery, an AI drain or an outbox drain. The two failure modes are kept
   * apart on purpose: a failed READ buffers nothing (a failed read is not evidence), while a failed
   * LOG keeps the observation, because the observation is real and only its narration was lost.
   */
  async record(companyId: string | null, featureKey: string | null, routeKey = 'DEFAULT'): Promise<ShadowDecision> {
    let decision: ShadowDecision;
    try {
      decision = await this.decide(companyId, featureKey, routeKey);
    } catch (err) {
      // Nothing is buffered, so no bucket row can later claim this observation happened, and the
      // caller's flow continues untouched.
      this.warnSafely(LAUNCH_SHADOW_READ_FAILED_EVENT, { featureKey, routeKey }, err);
      return { wouldBlock: false, reason: 'read_failed' };
    }
    // An unmapped observation has no owning gate; it is counted under the sentinel so it lands in
    // the coverage denominator instead of being attributed to a route it never named.
    const gateKey = featureKey ?? UNMAPPED_GATE_KEY;
    const key = `${gateKey}\u0000${routeKey}\u0000${decision.reason}`;
    const bucket = this.buckets.get(key)
      ?? { gateKey, routeKey, reason: decision.reason, wouldBlock: decision.wouldBlock, count: 0 };
    bucket.count += 1;
    this.buckets.set(key, bucket);
    // NO companyId, deliberately. The durable buckets are tenant-free by construction; a structured
    // log line carrying the tenant would reintroduce in the central log index exactly the per-tenant
    // shadow trail runbook §2.3 forbids the health view from exposing — on every instrumented
    // surface at once.
    this.logSafely(
      {
        event: LAUNCH_SHADOW_EVENT,
        surface: this.surface,
        featureKey,
        routeKey,
        wouldBlock: decision.wouldBlock,
        reason: decision.reason,
      },
      LAUNCH_SHADOW_EVENT,
    );
    return decision;
  }

  /**
   * One summary line per sweep, then the durable fold. The returned summary stays keyed by reason
   * (summed across routes) — that is what the log line has always said and what callers read.
   *
   * Persisting here rather than per observation is a load decision, not a shortcut: the outbox
   * drain claims ≤25 items every 30s at concurrency 2 and campaign delivery ≤50 every 15s at
   * concurrency 1, so a per-sweep fold writes ~0.3 rows/sec against a measured ~80/sec ceiling on a
   * contended key. Per-observation upserts would buy nothing and cost a round trip per item.
   */
  async flush(): Promise<Record<string, number>> {
    const summary: Record<string, number> = {};
    for (const bucket of this.buckets.values()) {
      summary[bucket.reason] = (summary[bucket.reason] ?? 0) + bucket.count;
    }
    if (this.buckets.size > 0) {
      // Summary line is reason-keyed only — no tenant appears here either (F2).
      this.logSafely(
        { event: `${LAUNCH_SHADOW_EVENT}.summary`, surface: this.surface, ...summary },
        `${LAUNCH_SHADOW_EVENT}.summary`,
      );
      await this.persist();
    }
    return summary;
  }

  /**
   * Every logger call on this class goes through one of these two, so NO path of the probe can
   * throw — not the read, not the persist, and not the narration of either. A logger that is itself
   * broken (transport down, serializer blowing up on a payload) must not be able to fail the drain
   * it is only observing; there is nowhere left to report that, so it is swallowed silently.
   */
  private logSafely(payload: Record<string, unknown>, message: string): void {
    try {
      this.logger.info(payload, message);
    } catch {
      // Intentionally empty: reporting a logging failure needs the logger.
    }
  }

  /**
   * Shadow warnings carry a STABLE CATEGORY, never the raw exception text.
   *
   * The message of a failed entitlement read is written by whatever threw it, and a driver or
   * repository is entirely free to embed the tenant it was querying ("... for companyId co-42").
   * Copying `err.message` into a structured warn would therefore reintroduce, on the one path that
   * actually fires during an incident, exactly the per-tenant shadow trail the buckets are designed
   * not to have — and no absence assertion over a SUCCESSFUL sweep would ever catch it, because a
   * successful sweep emits no warns at all.
   *
   * What ops keeps: the event name, the surface (a code constant, never tenant-bearing), the
   * feature/route context, and the error's class plus its driver code when it has one. That is
   * enough to tell `PrismaClientInitializationError` from a `TypeError`, and `P1001` (cannot reach
   * database) from `P2002` — which is the triage question — without carrying any tenant value.
   */
  private warnSafely(event: string, context: Record<string, unknown>, err: unknown): void {
    try {
      this.logger.warn(
        { event, surface: this.surface, ...context, ...errorCategory(err) },
        event,
      );
    } catch {
      // Intentionally empty: see logSafely.
    }
  }

  /**
   * Folds the sweep into hourly buckets. NEVER throws: this probe's whole contract is that a
   * surface which is entitlement-blind today stays exactly as blind, and an evidence write must not
   * be able to fail a drain. A lost fold shows up afterwards as a hole in the health view's
   * `hoursObserved`, which is the honest signal.
   *
   * The hour is stamped ONCE, at flush. A sweep that straddles an hour boundary attributes its
   * whole batch to the flush hour; sweeps run for seconds, so the skew is bounded by one sweep.
   */
  private async persist(): Promise<void> {
    const hourStartUtc = shadowBucketHour();
    try {
      // Sequential on purpose: a handful of rows per sweep, and one connection is plenty.
      for (const bucket of this.buckets.values()) {
        const key = {
          hourStartUtc,
          targetEnvironment: this.deployment.targetEnvironment,
          buildReleaseId: this.deployment.buildReleaseId,
          surface: this.surface,
          gateKey: bucket.gateKey,
          routeKey: bucket.routeKey,
          reason: bucket.reason,
          wouldBlock: bucket.wouldBlock,
        };
        // Scalar-only `where` on the single unique + a non-empty `update` = ONE native
        // `INSERT … ON CONFLICT DO UPDATE`. Never create-then-catch-P2002, and never a
        // read-modify-write that could lose an increment.
        await this.prisma.client.featureLaunchObservationBucket.upsert({
          where: { bucketKey: key },
          create: { ...key, observedCount: bucket.count },
          update: { observedCount: { increment: bucket.count } },
        });
      }
    } catch (err) {
      this.warnSafely(LAUNCH_SHADOW_PERSIST_FAILED_EVENT, { buckets: this.buckets.size }, err);
    }
  }

  /** `wouldBlock` is DERIVED, never hand-written per branch, so it cannot drift from the set. */
  private async decide(companyId: string | null, featureKey: string | null, routeKey: string): Promise<ShadowDecision> {
    const reason = await this.decideReason(companyId, featureKey, routeKey);
    return { wouldBlock: SHADOW_BLOCKING_REASONS.has(reason), reason };
  }

  private async decideReason(companyId: string | null, featureKey: string | null, routeKey: string): Promise<ShadowReason> {
    // An event whose owning feature is not mapped yet is recorded, not guessed at. It does not
    // count as blocked: claiming a block for an unknown owner would be fabricated evidence.
    if (!featureKey) return 'unmapped_feature';

    if (companyId) {
      const entitled = await this.entitlements(companyId);
      // null = the legacy fail-open cohort (no entitlement rows at all), which passes today.
      if (entitled && entitled.get(featureKey) !== true) return 'feature_disabled';
    }

    const gate = (await this.gateRows()).get(`${featureKey} ${routeKey}`);
    // Absent row = CLOSED, matching `LaunchGateGuardService` and the schema default.
    if (gate?.state !== 'OPEN') return 'launch_gate_closed';

    return companyId ? 'available' : 'no_company';
  }

  private async gateRows(): Promise<Map<string, { state: string; generation: number }>> {
    if (!this.gates) {
      const rows = await this.prisma.client.featureLaunchGate.findMany({
        select: { gateKey: true, routeKey: true, state: true, generation: true },
      });
      this.gates = new Map(rows.map((row) => [`${row.gateKey} ${row.routeKey}`, { state: row.state, generation: row.generation }]));
    }
    return this.gates;
  }

  private async entitlements(companyId: string): Promise<Map<string, boolean> | null> {
    if (!this.entitlementsByCompany.has(companyId)) {
      const rows = await this.prisma.client.companyFeatureEntitlement.findMany({
        where: { companyId },
        select: { featureKey: true, enabled: true },
      });
      this.entitlementsByCompany.set(
        companyId,
        rows.length === 0 ? null : new Map(rows.map((row) => [row.featureKey, row.enabled])),
      );
    }
    return this.entitlementsByCompany.get(companyId) ?? null;
  }
}
