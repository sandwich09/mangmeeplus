/**
 * Internal launch-health view (runbook §2, AC29/FR-G5). Read-only: it never mutates and never
 * calls a domain use case.
 *
 * Two row types, deliberately separate objects (runbook R-a):
 *   A — one launch-gate row per materializable (gateKey, routeKey): OPEN|CLOSED + generation.
 *   B — one tenant-anonymous lifecycle aggregate per featureKey: ON|DRAINING|OFF counts.
 *
 * Fields whose source lands in F1.4 (shadow/fallback/denied counters, ExecutionAttempt in-flight,
 * unknown-outcome, queue age, environment identity, running build id, evidence staleness) are
 * returned as `null` under their reserved names. They are NEVER fabricated or approximated —
 * runbook §2.4 lists them as TBD-F1, and a plausible-looking zero would read as evidence.
 *
 * Never emitted (runbook §2.3): any companyId, company name, tenant identity, customer content, or
 * any per-tenant route state — no such thing exists in v5.1 and the view must not imply one.
 */
import { Injectable } from '@nestjs/common';
import { resolveDeploymentIdentity } from '@watchdog-bms/config';
import { PrismaService } from '../../../../common/database/prisma.service';
import { SHADOW_BUCKET_HOUR_MS, UNMAPPED_GATE_KEY, shadowBucketHour } from '../launch-shadow.probe';
import {
  expectedShadowSurfaces,
  hasAsyncShadowCatalog,
  shadowCoverageComplete,
} from '../../domain/shadow-surface.catalog';
import { aggregateDrainingByFeature } from '../runoff-lifecycle';
import {
  MATERIALIZABLE_LAUNCH_MATRIX_ROWS,
  NON_MATERIALIZABLE_LAUNCH_MATRIX_ROWS,
  type LaunchGateState,
  type LaunchRouteClass,
} from '../../domain/launch-matrix.catalog';

/**
 * Trailing observation window for the shadow evidence (runbook R1 step 2 requires "0 in the
 * observation window" but names no length). Fixed, not caller-selectable: an operator who can pick
 * the window can pick the one that reads 0.
 */
const SHADOW_WINDOW_HOURS = 24;

/**
 * Metric names reserved by runbook §2.1 whose source is still missing.
 *
 * `wouldBlock` is NO LONGER here — it is real, read from `FeatureLaunchObservationBucket`. It is
 * always reported beside `shadow.observed`, because "0 blocks out of 5,000 observations" and "0
 * blocks because nothing was observed" must never be the same answer to R1.
 *
 * `environment`/`runningBuildReleaseId` stay null per gate row: they belong to runbook T15/T16,
 * whose owner fills them. The environment the shadow numbers were filtered to is reported once,
 * truthfully, under `shadowWindow.environment`.
 *
 * `terminalSuppressed` stays null per gate row because an `ExecutionAttempt` records its routes
 * inside `launchEntriesJson` and terminal rows accumulate without bound; the exact per-reason
 * totals are reported once under `attempts` below instead.
 */
const RESERVED_GATE_METRICS = {
  environment: null,
  runningBuildReleaseId: null,
  evidenceStale: null,
} as const;

/** Split from the block above because `counts.wouldBlock` beside them is now a real number. */
const RESERVED_GATE_COUNTS = {
  commandConflicts: null,
  fallbackServed: null,
  denied: null,
  terminalSuppressed: null,
} as const;

/**
 * Non-terminal `ExecutionAttempt` statuses. Bounded by definition — this is work in flight, which
 * is exactly what an operator acts on — so attributing it per route by reading the rows is safe,
 * while the unbounded terminal history is only ever counted with `groupBy`.
 */
const OPEN_ATTEMPT_STATUSES = ['QUEUED', 'CLAIMED', 'DISPATCHING', 'UNKNOWN_EXTERNAL_OUTCOME'] as const;

type AgeCount = { count: number; oldestAgeSec: number | null };
const emptyAgeCount = (): AgeCount => ({ count: 0, oldestAgeSec: null });

/** Per-route shadow evidence for R1 step 2. Tenant-free by construction — the buckets hold no ids. */
export type GateShadowMetrics = {
  /** The denominator. `wouldBlock: 0` means nothing only when this is > 0. */
  observed: number;
  wouldBlock: number;
  /** Distinct hourly buckets carrying data — evidence of continuous shadow, not one burst. */
  hoursObserved: number;
  lastObservedHourUtc: string | null;
  bySurface: Record<string, number>;
  byReason: Record<string, number>;
  /**
   * COVERAGE, which the buckets alone cannot express (piece 5). `bySurface` is built from whatever
   * rows exist, so a surface nobody instrumented reads identically to a surface that was quiet.
   * These three come from `SHADOW_SURFACE_CATALOG` instead, so R1 step 2 becomes an operator check
   * rather than a re-reading of the 63-row async inventory.
   */
  surfacesExpected: string[];
  /**
   * Expected surfaces that actually OBSERVED work in the window — `SUM(observedCount) > 0`, not
   * mere key presence. `observedCount` defaults to 0 in the schema, so a bucket row can exist for a
   * surface that measured nothing; deriving from key presence would let such a row empty
   * `surfacesMissing` and report a false-complete window to R1.
   */
  surfacesObserved: string[];
  /** `surfacesExpected` minus `surfacesObserved`. Set complement, so it can only shrink on real counts. */
  surfacesMissing: string[];
  /**
   * True when every async surface this family owns is instrumented at all. FALSE for a gate with no
   * async surfaces (`reports`, `product_catalog`, `line_oa`): they have nothing to complete, which
   * is why it is read together with an empty `surfacesExpected` and never on its own.
   */
  coverageComplete: boolean;
};
const emptyShadowMetrics = (): GateShadowMetrics => ({
  observed: 0,
  wouldBlock: 0,
  hoursObserved: 0,
  lastObservedHourUtc: null,
  bySurface: {},
  byReason: {},
  surfacesExpected: [],
  surfacesObserved: [],
  surfacesMissing: [],
  coverageComplete: false,
});

/**
 * Window-wide coverage. There is deliberately NO tenant dimension: the buckets carry no companyId,
 * so a distinct-company count is not merely unavailable, it is forbidden. Coverage is instead
 * expressed through observation (`mapped/observed`), stable route names, temporal
 * (`hoursObserved/windowHours`) and surface (`bySurface`). The separate evidence tracks below keep
 * the 20-row materialized catalog from being misreported as an achievable async denominator.
 */
export type LaunchRouteRef = { gateKey: string; routeKey: string };

export type ShadowWindowSummary = {
  windowHours: number;
  fromHourUtc: string;
  environment: string;
  /** Every build that contributed evidence in this window; a rolling deploy legitimately has two. */
  builds: string[];
  observed: number;
  /** `observed` minus the observations whose owning feature is not mapped yet. */
  mapped: number;
  wouldBlock: number;
  hoursObserved: number;
  /** Stable, tenant-anonymous exact route names; unmapped observations are excluded. */
  observedRoutes: LaunchRouteRef[];
  bySurface: Record<string, { observed: number; mapped: number; wouldBlock: number }>;
  unmappedBySurface: Record<string, number>;
};

/** U5-A evidence tracks. `null` means A5 has no durable source for that human/journey result. */
export type LaunchEvidenceTracks = {
  materialized: { present: number; required: number };
  async: { catalogComplete: number; observed: number; required: number };
  synchronous: { journeysPassed: null; required: number };
  specialist: { accepted: null; required: number };
  deferred: { closed: number; required: number };
};

/** The bucket columns this view reads. No companyId exists on the row to leave out. */
type ObservationBucketRow = {
  hourStartUtc: Date;
  buildReleaseId: string;
  surface: string;
  gateKey: string;
  routeKey: string;
  reason: string;
  wouldBlock: boolean;
  observedCount: number;
};

/**
 * Metric names reserved by runbook §2.2 whose source arrives in F1.4 / F2 (CC7).
 *
 * `oldestDrainingAgeHours` and `drainingOpenItems` LEFT this set with the runoff lifecycle — both
 * are derivable from `EntitlementTransition` + `RunoffSnapshot` with no new storage.
 * `drainingReconcilerLastRunAt` and `reconcilerErrors` stay reserved (coordinator ruling OQ-6):
 * they describe RUNS of the reconciler, which nothing durably records, so filling them would need
 * a table and therefore a migration. The sweep endpoint returns its own per-call counts instead.
 */
const RESERVED_LIFECYCLE_METRICS = {
  drainingReconcilerLastRunAt: null,
  reconcilerErrors: null,
  epochMismatchSuppressed: null,
  nullEpochPending: null,
  backfill: { authorized: null, running: null, needsReview: null, failed: null, maxLagMin: null },
  normalizationIncomplete: null,
} as const;

export type LaunchGateHealthRow = {
  gateKey: string;
  routeKey: string;
  routeClass: LaunchRouteClass;
  matrixRowStatus: 'RESOLVED' | 'BLOCKED';
  state: LaunchGateState;
  generation: number;
  lastSeq: number;
  reason: string | null;
  updatedAt: string | null;
  /** null until the row has had at least one real transition. */
  lastTransition: {
    seq: number;
    action: 'OPEN' | 'CLOSE';
    commandId: string;
    actorUserId: string;
    payloadFingerprint: string;
    createdAt: string;
    snapshot: {
      targetEnvironment: string;
      buildReleaseId: string;
      expectedGeneration: number;
      routeClass: LaunchRouteClass;
      validationEvidenceRef: string | null;
      validationEvidenceHash: string | null;
      specialistApprovedByUserId: string | null;
      releaseApprovedByUserId: string | null;
      emergencyClose: boolean;
      emergencyAuthorityUserId: string | null;
      incidentRef: string | null;
    };
  } | null;
  /** Real `ExecutionAttempt` counts attributed to this exact route by its stamped launch entries. */
  inFlight: AgeCount;
  unknownOutcome: AgeCount;
  queued: AgeCount;
  counts: typeof RESERVED_GATE_COUNTS & { wouldBlock: number };
  /** Durable would_block evidence for this exact route over `shadowWindow`. */
  shadow: GateShadowMetrics;
} & typeof RESERVED_GATE_METRICS;

export type FeatureLifecycleHealthRow = {
  featureKey: string;
  companiesOn: number;
  companiesDraining: number;
  companiesOff: number;
  /**
   * `null` when no company is draining this feature — deliberately NOT `0`. "Nothing draining" and
   * "draining with nothing left to do" are different operator situations, and R5 triages on the
   * difference (the same reason `counts.wouldBlock` refuses to report 0 without a denominator).
   */
  drainingOpenItems: number | null;
  /** Non-zero means openItems is unknown and must not be shown as zero/drained. */
  drainingInspectionErrors: number;
  /** True when the bounded inspector scan could not inspect every draining company in this family. */
  drainingInspectionTruncated: boolean;
  oldestDrainingAgeHours: number | null;
} & typeof RESERVED_LIFECYCLE_METRICS;

export type LaunchHealthView = {
  gates: LaunchGateHealthRow[];
  featureLifecycle: FeatureLifecycleHealthRow[];
  /** Matrix rows that cannot own a gate row, surfaced with their reason instead of dropped. */
  unmaterializedMatrixRows: Array<{ gateKey: string; routeKey: string; reason: string }>;
  /** Exact `ExecutionAttempt` totals by status, tenant-anonymous. `{}` means no attempts exist. */
  attempts: Record<string, number>;
  /** Coverage of the durable shadow evidence the per-row `shadow`/`counts.wouldBlock` come from. */
  shadowWindow: ShadowWindowSummary;
  /** Materialized, async, synchronous, specialist and deferred evidence are distinct denominators. */
  evidenceTracks: LaunchEvidenceTracks;
};

const routeKey = (row: LaunchRouteRef): string => `${row.gateKey}\u0000${row.routeKey}`;
const routeRef = (row: LaunchRouteRef): LaunchRouteRef => ({ gateKey: row.gateKey, routeKey: row.routeKey });
const compareText = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;
const compareRoute = (left: LaunchRouteRef, right: LaunchRouteRef): number =>
  compareText(left.gateKey, right.gateKey) || compareText(left.routeKey, right.routeKey);

const DEFERRED_ROWS = MATERIALIZABLE_LAUNCH_MATRIX_ROWS.filter((row) => row.openPolicy === 'FORBIDDEN_V5_1');
const SPECIALIST_ROWS = MATERIALIZABLE_LAUNCH_MATRIX_ROWS.filter((row) =>
  row.routeClass === 'SPECIALIST_LEGAL' && row.openPolicy !== 'FORBIDDEN_V5_1');
const ASYNC_ROWS = MATERIALIZABLE_LAUNCH_MATRIX_ROWS.filter((row) =>
  row.routeClass === 'ORDINARY' && hasAsyncShadowCatalog(row.gateKey, row.routeKey));
const SYNCHRONOUS_ROWS = MATERIALIZABLE_LAUNCH_MATRIX_ROWS.filter((row) =>
  row.routeClass === 'ORDINARY' && !hasAsyncShadowCatalog(row.gateKey, row.routeKey));

@Injectable()
export class GetLaunchHealthUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(): Promise<LaunchHealthView> {
    // Read directly, as `LaunchGateGuardService` does — a pure function of the environment does not
    // need to become a constructor dependency.
    const deployment = resolveDeploymentIdentity(process.env);
    // Stamped ONCE so the two bounds cannot straddle an hour tick and disagree with each other.
    const currentHourUtc = shadowBucketHour();
    const fromHourUtc = new Date(currentHourUtc.getTime() - (SHADOW_WINDOW_HOURS - 1) * SHADOW_BUCKET_HOUR_MS);

    const [attemptTotals, openAttempts, buckets] = await Promise.all([
      this.prisma.client.executionAttempt.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.client.executionAttempt.findMany({
        where: { status: { in: [...OPEN_ATTEMPT_STATUSES] } },
        select: { status: true, launchEntriesJson: true, createdAt: true },
      }),
      // Filtered to THIS environment: evidence attested in uat never authorized production
      // (spec CC1). Deliberately NOT filtered by build — a rolling deploy would otherwise reset the
      // evidence to zero and block R1 for a full window after every deploy; the contributing builds
      // are reported instead so the operator can see what the window actually spans.
      //
      // Bounded on BOTH sides. Future evidence is not evidence: a clock-skewed writer or a
      // malformed insert dated ahead of now would otherwise count immediately, push
      // `hoursObserved` past `windowHours`, and let R1's "0 in the observation window" be
      // satisfied by an hour that has not happened yet.
      this.prisma.client.featureLaunchObservationBucket.findMany({
        where: {
          hourStartUtc: { gte: fromHourUtc, lte: currentHourUtc },
          targetEnvironment: deployment.targetEnvironment,
        },
        select: {
          hourStartUtc: true,
          buildReleaseId: true,
          surface: true,
          gateKey: true,
          routeKey: true,
          reason: true,
          wouldBlock: true,
          observedCount: true,
        },
      }),
    ]);

    const shadowByRoute = this.shadowMetrics(buckets);
    const shadowWindow = this.shadowWindow(buckets, deployment.targetEnvironment, fromHourUtc);
    const gateProjection = await this.gateRows(openAttempts, shadowByRoute);

    return {
      gates: gateProjection.rows,
      featureLifecycle: await this.lifecycleRows(),
      unmaterializedMatrixRows: NON_MATERIALIZABLE_LAUNCH_MATRIX_ROWS.map((row) => ({
        gateKey: row.gateKey,
        routeKey: row.routeKey,
        reason: row.notMaterializableReason ?? 'not materializable',
      })),
      attempts: Object.fromEntries(attemptTotals.map((row) => [row.status, row._count?._all ?? 0])),
      shadowWindow,
      evidenceTracks: this.evidenceTracks(gateProjection.presentKeys, gateProjection.rows, shadowWindow.observedRoutes),
    };
  }

  /**
   * Folds the window's buckets onto exact `(gateKey, routeKey)` routes. Bounded by the window, so
   * the same in-memory pass the open-attempt metrics already use is the right shape here too.
   */
  private shadowMetrics(buckets: ObservationBucketRow[]): Map<string, GateShadowMetrics> {
    const byRoute = new Map<string, GateShadowMetrics>();
    const hoursByRoute = new Map<string, Set<number>>();
    for (const bucket of buckets) {
      // Unmapped observations name no route; they are coverage, counted in `shadowWindow` only.
      if (bucket.gateKey === UNMAPPED_GATE_KEY) continue;
      const key = `${bucket.gateKey} ${bucket.routeKey}`;
      const row = byRoute.get(key) ?? emptyShadowMetrics();
      row.observed += bucket.observedCount;
      if (bucket.wouldBlock) row.wouldBlock += bucket.observedCount;
      row.bySurface[bucket.surface] = (row.bySurface[bucket.surface] ?? 0) + bucket.observedCount;
      row.byReason[bucket.reason] = (row.byReason[bucket.reason] ?? 0) + bucket.observedCount;
      const hours = hoursByRoute.get(key) ?? new Set<number>();
      hours.add(bucket.hourStartUtc.getTime());
      hoursByRoute.set(key, hours);
      byRoute.set(key, row);
    }
    for (const [key, hours] of hoursByRoute) {
      const row = byRoute.get(key)!;
      row.hoursObserved = hours.size;
      row.lastObservedHourUtc = new Date(Math.max(...hours)).toISOString();
    }
    return byRoute;
  }

  private shadowWindow(buckets: ObservationBucketRow[], environment: string, fromHourUtc: Date): ShadowWindowSummary {
    const summary: ShadowWindowSummary = {
      windowHours: SHADOW_WINDOW_HOURS,
      fromHourUtc: fromHourUtc.toISOString(),
      environment,
      builds: [],
      observed: 0,
      mapped: 0,
      wouldBlock: 0,
      hoursObserved: 0,
      observedRoutes: [],
      bySurface: {},
      unmappedBySurface: {},
    };
    const builds = new Set<string>();
    const hours = new Set<number>();
    const routes = new Map<string, LaunchRouteRef>();
    for (const bucket of buckets) {
      const mapped = bucket.gateKey !== UNMAPPED_GATE_KEY;
      summary.observed += bucket.observedCount;
      if (mapped) {
        summary.mapped += bucket.observedCount;
        if (bucket.observedCount > 0) routes.set(routeKey(bucket), routeRef(bucket));
      } else {
        summary.unmappedBySurface[bucket.surface] = (summary.unmappedBySurface[bucket.surface] ?? 0) + bucket.observedCount;
      }
      if (bucket.wouldBlock) summary.wouldBlock += bucket.observedCount;
      const surface = summary.bySurface[bucket.surface] ?? { observed: 0, mapped: 0, wouldBlock: 0 };
      surface.observed += bucket.observedCount;
      if (mapped) surface.mapped += bucket.observedCount;
      if (bucket.wouldBlock) surface.wouldBlock += bucket.observedCount;
      summary.bySurface[bucket.surface] = surface;
      if (bucket.observedCount > 0) {
        builds.add(bucket.buildReleaseId);
        hours.add(bucket.hourStartUtc.getTime());
      }
    }
    summary.builds = [...builds].sort();
    summary.hoursObserved = hours.size;
    summary.observedRoutes = [...routes.values()].sort(compareRoute);
    return summary;
  }

  private evidenceTracks(
    presentKeys: ReadonlySet<string>,
    gates: LaunchGateHealthRow[],
    observedRoutes: readonly LaunchRouteRef[],
  ): LaunchEvidenceTracks {
    const asyncKeys = new Set(ASYNC_ROWS.map(routeKey));
    const deferredKeys = new Set(DEFERRED_ROWS.map(routeKey));
    return {
      materialized: {
        present: MATERIALIZABLE_LAUNCH_MATRIX_ROWS.filter((row) => presentKeys.has(routeKey(row))).length,
        required: MATERIALIZABLE_LAUNCH_MATRIX_ROWS.length,
      },
      async: {
        catalogComplete: ASYNC_ROWS.filter((row) => shadowCoverageComplete(row.gateKey)).length,
        observed: observedRoutes.filter((row) => asyncKeys.has(routeKey(row))).length,
        required: ASYNC_ROWS.length,
      },
      synchronous: { journeysPassed: null, required: SYNCHRONOUS_ROWS.length },
      specialist: { accepted: null, required: SPECIALIST_ROWS.length },
      deferred: {
        closed: gates.filter((row) => deferredKeys.has(routeKey(row))
          && presentKeys.has(routeKey(row)) && row.state === 'CLOSED').length,
        required: DEFERRED_ROWS.length,
      },
    };
  }

  /**
   * Buckets the bounded open-attempt set onto the exact `(gateKey, routeKey)` rows each attempt
   * stamped. An attempt required every route it lists, so it counts against each of them.
   */
  private attemptMetrics(
    openAttempts: Array<{ status: string; launchEntriesJson: unknown; createdAt: Date }>,
  ): Map<string, { inFlight: AgeCount; unknownOutcome: AgeCount; queued: AgeCount }> {
    const now = Date.now();
    const byRoute = new Map<string, { inFlight: AgeCount; unknownOutcome: AgeCount; queued: AgeCount }>();
    for (const attempt of openAttempts) {
      const entries = Array.isArray(attempt.launchEntriesJson)
        ? (attempt.launchEntriesJson as Array<{ gateKey?: unknown; routeKey?: unknown }>)
        : [];
      const bucket = attempt.status === 'QUEUED'
        ? 'queued'
        : attempt.status === 'UNKNOWN_EXTERNAL_OUTCOME' ? 'unknownOutcome' : 'inFlight';
      const ageSec = Math.max(0, Math.floor((now - attempt.createdAt.getTime()) / 1000));
      for (const entry of entries) {
        if (typeof entry?.gateKey !== 'string' || typeof entry?.routeKey !== 'string') continue;
        const key = `${entry.gateKey} ${entry.routeKey}`;
        const row = byRoute.get(key)
          ?? { inFlight: emptyAgeCount(), unknownOutcome: emptyAgeCount(), queued: emptyAgeCount() };
        row[bucket].count += 1;
        row[bucket].oldestAgeSec = Math.max(row[bucket].oldestAgeSec ?? 0, ageSec);
        byRoute.set(key, row);
      }
    }
    return byRoute;
  }

  private async gateRows(
    openAttempts: Array<{ status: string; launchEntriesJson: unknown; createdAt: Date }>,
    shadowByRoute: Map<string, GateShadowMetrics>,
  ): Promise<{ rows: LaunchGateHealthRow[]; presentKeys: Set<string> }> {
    const gates = await this.prisma.client.featureLaunchGate.findMany({
      select: { gateKey: true, routeKey: true, state: true, generation: true, lastSeq: true, reason: true, updatedAt: true },
    });
    const gateByKey = new Map(gates.map((gate) => [`${gate.gateKey} ${gate.routeKey}`, gate]));

    // `lastSeq` already points at the newest transition, so this is an exact fetch rather than an
    // order-by-desc scan of the whole append-only child.
    const wanted = gates.filter((gate) => gate.lastSeq > 0);
    const transitions = wanted.length === 0
      ? []
      : await this.prisma.client.featureLaunchGateTransition.findMany({
        where: { OR: wanted.map((gate) => ({ gateKey: gate.gateKey, routeKey: gate.routeKey, seq: gate.lastSeq })) },
        select: {
          gateKey: true,
          routeKey: true,
          seq: true,
          action: true,
          commandId: true,
          actorUserId: true,
          payloadFingerprint: true,
          createdAt: true,
          targetEnvironment: true,
          buildReleaseId: true,
          expectedGeneration: true,
          routeClass: true,
          validationEvidenceRef: true,
          validationEvidenceHash: true,
          specialistApprovedByUserId: true,
          releaseApprovedByUserId: true,
          emergencyClose: true,
          emergencyAuthorityUserId: true,
          incidentRef: true,
        },
      });
    const transitionByKey = new Map(transitions.map((row) => [`${row.gateKey} ${row.routeKey}`, row]));

    const attemptsByRoute = this.attemptMetrics(openAttempts);

    const rows = MATERIALIZABLE_LAUNCH_MATRIX_ROWS.map((matrixRow) => {
      const key = `${matrixRow.gateKey} ${matrixRow.routeKey}`;
      const gate = gateByKey.get(key);
      const transition = transitionByKey.get(key);
      const attempts = attemptsByRoute.get(key);
      const shadow = shadowByRoute.get(key) ?? emptyShadowMetrics();
      // Coverage is catalog-derived, never bucket-derived (piece 5). The EXPECTED set names the
      // surfaces that must report; OBSERVED keeps only those with a real count, because
      // `observedCount` defaults to 0 and a zero-count row must never look like measurement;
      // MISSING is the set complement. An unexpected surface name stays in the raw `bySurface`
      // only — it cannot reduce `surfacesMissing`, so instrumenting the wrong name can never
      // satisfy the coverage bar for the right one.
      shadow.surfacesExpected = [...expectedShadowSurfaces(matrixRow.gateKey, matrixRow.routeKey)];
      shadow.surfacesObserved = shadow.surfacesExpected.filter((surface) => (shadow.bySurface[surface] ?? 0) > 0);
      shadow.surfacesMissing = shadow.surfacesExpected.filter((surface) => !shadow.surfacesObserved.includes(surface));
      shadow.coverageComplete = shadowCoverageComplete(matrixRow.gateKey);
      return {
        gateKey: matrixRow.gateKey,
        routeKey: matrixRow.routeKey,
        routeClass: matrixRow.routeClass,
        matrixRowStatus: matrixRow.matrixRowStatus,
        // An unseeded route reads exactly like the schema default: CLOSED at generation 0.
        state: (gate?.state ?? 'CLOSED') as LaunchGateState,
        generation: gate?.generation ?? 0,
        lastSeq: gate?.lastSeq ?? 0,
        reason: gate?.reason ?? null,
        updatedAt: gate?.updatedAt?.toISOString() ?? null,
        lastTransition: transition
          ? {
            seq: transition.seq,
            action: transition.action as 'OPEN' | 'CLOSE',
            commandId: transition.commandId,
            actorUserId: transition.actorUserId,
            payloadFingerprint: transition.payloadFingerprint,
            createdAt: transition.createdAt.toISOString(),
            snapshot: {
              targetEnvironment: transition.targetEnvironment,
              buildReleaseId: transition.buildReleaseId,
              expectedGeneration: transition.expectedGeneration,
              routeClass: transition.routeClass as LaunchRouteClass,
              validationEvidenceRef: transition.validationEvidenceRef,
              validationEvidenceHash: transition.validationEvidenceHash,
              specialistApprovedByUserId: transition.specialistApprovedByUserId,
              releaseApprovedByUserId: transition.releaseApprovedByUserId,
              emergencyClose: transition.emergencyClose,
              emergencyAuthorityUserId: transition.emergencyAuthorityUserId,
              incidentRef: transition.incidentRef,
            },
          }
          : null,
        // Real, and zero only because no attempt stamped this route — not because it went unmeasured.
        inFlight: attempts?.inFlight ?? emptyAgeCount(),
        unknownOutcome: attempts?.unknownOutcome ?? emptyAgeCount(),
        queued: attempts?.queued ?? emptyAgeCount(),
        // A route with no buckets reads `observed: 0`, which is what tells R1 that this zero is an
        // absence of measurement rather than an absence of blocks.
        shadow,
        counts: { ...RESERVED_GATE_COUNTS, wouldBlock: shadow.wouldBlock },
        ...RESERVED_GATE_METRICS,
      };
    });
    return { rows, presentKeys: new Set(gates.map(routeKey)) };
  }

  private async lifecycleRows(): Promise<FeatureLifecycleHealthRow[]> {
    const grouped = await this.prisma.client.companyFeatureEntitlement.groupBy({
      by: ['featureKey', 'enabled'],
      _count: { _all: true },
    });

    // DRAINING is derived, never stored (spec:69). The derivation lives in `runoff-lifecycle.ts`
    // so this view and the completer can never disagree about who is draining — a view that said
    // DRAINING while the completer said NOT_DRAINING would make R5 untriageable.
    //
    // r18 F4 — the UNTRUNCATED aggregate, never the bounded ops page. A page would silently count a
    // draining company as OFF at one drain past the limit, and could hide the true oldest drain —
    // under-reporting `W3 DRAINING age` exactly when there is most to report.
    const drainingByFeature = await aggregateDrainingByFeature(this.prisma);

    const byFeature = new Map<string, { on: number; off: number }>();
    for (const row of grouped) {
      const counts = byFeature.get(row.featureKey) ?? { on: 0, off: 0 };
      const count = row._count?._all ?? 0;
      if (row.enabled) counts.on += count;
      else counts.off += count;
      byFeature.set(row.featureKey, counts);
    }

    const now = Date.now();
    return [...byFeature.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([featureKey, counts]) => {
        const drain = drainingByFeature.get(featureKey);
        const drainingCount = drain?.companies ?? 0;
        return {
          featureKey,
          companiesOn: counts.on,
          companiesDraining: drainingCount,
          // A draining company holds a DISABLED row (coordinator ruling OQ-2: `enabled=false` lands
          // in the DISABLE_REQUESTED transaction, so spec:60's "immediately rejects new interactive
          // root mutations and external sends" is enforced by machinery that already exists).
          // It is therefore inside `counts.off`, and reporting it once means subtracting it HERE.
          // The pre-lifecycle code subtracted from `companiesOn` on the opposite assumption.
          companiesOff: Math.max(counts.off - drainingCount, 0),
          ...RESERVED_LIFECYCLE_METRICS,
          // Runbook §2.2 / W3 / R5. Derived with no new storage; `null` when nothing is draining,
          // which is distinct from `0` ("draining, but nothing left to do").
          drainingOpenItems: drain && drain.inspectionErrors === 0 ? drain.openItems : null,
          drainingInspectionErrors: drain?.inspectionErrors ?? 0,
          drainingInspectionTruncated: drain?.inspectionTruncated ?? false,
          oldestDrainingAgeHours: drain
            ? Math.floor((now - drain.oldestRequestedAt.getTime()) / 3_600_000)
            : null,
        };
      });
  }
}
