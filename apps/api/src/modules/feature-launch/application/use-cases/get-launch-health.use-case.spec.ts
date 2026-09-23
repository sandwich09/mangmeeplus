import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveDeploymentIdentity } from '@watchdog-bms/config';
import { GetLaunchHealthUseCase } from './get-launch-health.use-case';
import { MATERIALIZABLE_LAUNCH_MATRIX_ROWS, NON_MATERIALIZABLE_LAUNCH_MATRIX_ROWS } from '../../domain/launch-matrix.catalog';
import { RUNOFF_MATRIX_VERSION } from '../../domain/runoff-matrix.catalog';
import { MAX_DRAINING_HEALTH_INSPECTIONS } from '../runoff-lifecycle';

/** The environment the use case will resolve, so fixtures live inside the filter it applies. */
const CURRENT_ENV = resolveDeploymentIdentity(process.env).targetEnvironment;
const EMPTY_RUNOFF_ROOTS = {
  matrixVersion: RUNOFF_MATRIX_VERSION,
  policyByRootType: {},
  roots: [],
  openCount: 0,
};

const TRANSITION = {
  gateKey: 'inventory',
  routeKey: 'DEFAULT',
  seq: 1,
  generation: 1,
  commandId: 'F1-SEED:inventory:DEFAULT:g0',
  action: 'OPEN',
  actorUserId: 'SYSTEM',
  payloadFingerprint: 'fp-1',
  reason: 'bootstrap',
  createdAt: new Date('2026-07-31T00:00:00.000Z'),
  targetEnvironment: 'production',
  buildReleaseId: 'F1-SEED',
  expectedGeneration: 0,
  routeClass: 'ORDINARY',
  validationEvidenceRef: null,
  validationEvidenceHash: null,
  specialistApprovedByUserId: null,
  releaseApprovedByUserId: 'SYSTEM',
  emergencyClose: false,
  emergencyAuthorityUserId: null,
  incidentRef: null,
};

/** Hour floor helper mirroring the probe's, so fixtures land in the window the view reads. */
const HOUR_MS = 3_600_000;
const hourFloor = (offsetHours = 0) => new Date(Math.floor(Date.now() / HOUR_MS) * HOUR_MS - offsetHours * HOUR_MS);

const bucket = (over: Partial<Record<string, any>> = {}) => ({
  hourStartUtc: hourFloor(),
  targetEnvironment: CURRENT_ENV,
  buildReleaseId: 'build-a',
  surface: 'outbox.drain',
  gateKey: 'crm',
  routeKey: 'DEFAULT',
  reason: 'available',
  wouldBlock: false,
  observedCount: 1,
  ...over,
});

/**
 * The fake APPLIES the where clause instead of returning every fixture. Without this, every
 * "row X is excluded" assertion below would pass no matter what the query said — the exclusion
 * tests would be vacuous.
 */
const applyBucketWhere = (rows: any[], where: any = {}) => rows.filter((row) => {
  if (where.targetEnvironment !== undefined && row.targetEnvironment !== where.targetEnvironment) return false;
  const bound = where.hourStartUtc ?? {};
  if (bound.gte !== undefined && row.hourStartUtc < bound.gte) return false;
  if (bound.lte !== undefined && row.hourStartUtc > bound.lte) return false;
  return true;
});

function makePrisma(opts: {
  gates?: any[];
  transitions?: any[];
  grouped?: any[];
  drainRequests?: any[];
  snapshots?: any[];
  fences?: any[];
  attemptTotals?: any[];
  openAttempts?: any[];
  buckets?: any[];
  onBucketQuery?: (args: any) => void;
} = {}) {
  return {
    client: {
      /**
       * Stands in for the live-drain keyset query. The real predicate is a cross-table column
       * comparison in raw SQL, proved against Postgres in `runoff-lifecycle.race.spec.ts`; this
       * reproduces its semantics so the lifecycle rows below stay meaningful.
       */
      $queryRaw: async (sql: any) => {
        const statement = String(sql.strings?.join('?') ?? '');
        if (!statement.includes('DISABLE_REQUESTED')) throw new Error(`unexpected raw query: ${statement}`);
        const fenceByKey = new Map((opts.fences ?? []).map((row: any) => [`${row.companyId} ${row.featureKey}`, row.lastSeq ?? 0]));
        const live = (opts.drainRequests ?? [])
          .filter((row: any) => fenceByKey.get(`${row.companyId} ${row.featureKey}`) === row.seq)
          .map((row: any) => ({ createdAt: new Date(), id: `${row.companyId}::${row.featureKey}`, ...row }));
        if (statement.includes('GROUP BY t."featureKey"')) {
          const grouped = new Map<string, any>();
          for (const row of live) {
            const current = grouped.get(row.featureKey);
            grouped.set(row.featureKey, {
              featureKey: row.featureKey,
              companies: (current?.companies ?? 0) + 1,
              oldestRequestedAt: current && current.oldestRequestedAt < row.createdAt
                ? current.oldestRequestedAt
                : row.createdAt,
            });
          }
          return [...grouped.values()];
        }
        const limit = statement.includes('LIMIT') ? Number(sql.values?.at(-1)) : live.length;
        return live.slice(0, limit);
      },
      featureLaunchGate: { findMany: async () => opts.gates ?? [] },
      featureLaunchGateTransition: { findMany: async () => opts.transitions ?? [] },
      companyFeatureEntitlement: {
        groupBy: async () => opts.grouped ?? [],
        findMany: async () => opts.fences ?? [],
      },
      entitlementTransition: {
        // `createdAt` is `@default(now())` and always present on a real read; the draining
        // derivation ages the drain from it.
        findMany: async () => (opts.drainRequests ?? []).map((row: any) => ({ createdAt: new Date(), ...row })),
      },
      runoffSnapshot: { findMany: async () => opts.snapshots ?? [] },
      executionAttempt: {
        groupBy: async () => opts.attemptTotals ?? [],
        findMany: async () => opts.openAttempts ?? [],
      },
      featureLaunchObservationBucket: {
        findMany: async (args: any) => {
          opts.onBucketQuery?.(args);
          return applyBucketWhere(opts.buckets ?? [], args?.where);
        },
      },
    },
  } as any;
}

describe('GetLaunchHealthUseCase — row type A (runbook §2.1)', () => {
  it('returns one row per materializable matrix route, unseeded routes reading CLOSED/0', async () => {
    const view = await new GetLaunchHealthUseCase(makePrisma()).execute();

    assert.equal(view.gates.length, MATERIALIZABLE_LAUNCH_MATRIX_ROWS.length);
    // cap.wht50bis's 3 routes moved to ORDINARY/OPEN (owner decision 2026-09-22): 19 seeded-OPEN +
    // 1 concrete specialist/deferred row (the still-forbidden VAT-credit-offset route).
    assert.equal(view.gates.length, 20, '19 seeded-OPEN + 1 concrete specialist/deferred row');
    for (const row of view.gates) {
      assert.equal(row.state, 'CLOSED');
      assert.equal(row.generation, 0);
      assert.equal(row.lastTransition, null);
    }
    assert.deepEqual(view.evidenceTracks, {
      materialized: { present: 0, required: 20 },
      async: { catalogComplete: 13, observed: 0, required: 13 },
      synchronous: { journeysPassed: null, required: 6 },
      specialist: { accepted: null, required: 0 },
      deferred: { closed: 0, required: 1 },
    });
  });

  it('counts only durable gate rows as materialized and the forbidden VAT route as deferred-closed', async () => {
    const gates = MATERIALIZABLE_LAUNCH_MATRIX_ROWS.map((row) => ({
      gateKey: row.gateKey,
      routeKey: row.routeKey,
      state: 'CLOSED',
      generation: 0,
      lastSeq: 0,
      reason: null,
      updatedAt: new Date('2026-08-03T00:00:00.000Z'),
    }));
    const view = await new GetLaunchHealthUseCase(makePrisma({ gates })).execute();

    assert.deepEqual(view.evidenceTracks.materialized, { present: 20, required: 20 });
    assert.deepEqual(view.evidenceTracks.deferred, { closed: 1, required: 1 });
  });

  it('projects the immutable control-plane snapshot of the last transition', async () => {
    const view = await new GetLaunchHealthUseCase(makePrisma({
      gates: [{ gateKey: 'inventory', routeKey: 'DEFAULT', state: 'OPEN', generation: 1, lastSeq: 1, reason: null, updatedAt: new Date('2026-07-31T00:00:00.000Z') }],
      transitions: [TRANSITION],
    })).execute();

    const row = view.gates.find((gate) => gate.gateKey === 'inventory')!;
    assert.equal(row.state, 'OPEN');
    assert.equal(row.generation, 1);
    assert.equal(row.lastTransition?.action, 'OPEN');
    assert.equal(row.lastTransition?.snapshot.buildReleaseId, 'F1-SEED');
    assert.equal(row.lastTransition?.snapshot.expectedGeneration, 0);
    assert.equal(row.lastTransition?.snapshot.emergencyClose, false);
    assert.equal(row.lastTransition?.snapshot.validationEvidenceHash, null);
  });

  it('reserves the still-unmeasured metric names as null instead of fabricating counts', async () => {
    const view = await new GetLaunchHealthUseCase(makePrisma()).execute();
    const row = view.gates[0]!;

    // environment/runningBuildReleaseId stay null per row — they belong to runbook T15/T16. The
    // environment the shadow numbers were filtered to is reported under shadowWindow instead.
    assert.equal(row.environment, null);
    assert.equal(row.runningBuildReleaseId, null);
    assert.equal(row.evidenceStale, null);
    assert.deepEqual(row.counts, {
      commandConflicts: null, wouldBlock: 0, fallbackServed: null, denied: null, terminalSuppressed: null,
    });
  });

  it('reports real ExecutionAttempt counts against the exact routes each attempt stamped', async () => {
    const createdAt = new Date(Date.now() - 120_000);
    const view = await new GetLaunchHealthUseCase(makePrisma({
      attemptTotals: [
        { status: 'QUEUED', _count: { _all: 1 } },
        { status: 'SUPPRESSED_LAUNCH_GATE_CLOSED', _count: { _all: 4 } },
      ],
      openAttempts: [
        { status: 'QUEUED', createdAt, launchEntriesJson: [{ gateKey: 'inventory', routeKey: 'DEFAULT', generation: 1 }] },
        { status: 'DISPATCHING', createdAt, launchEntriesJson: [{ gateKey: 'inventory', routeKey: 'DEFAULT', generation: 1 }] },
        { status: 'UNKNOWN_EXTERNAL_OUTCOME', createdAt, launchEntriesJson: [{ gateKey: 'crm', routeKey: 'DEFAULT', generation: 1 }] },
      ],
    })).execute();

    assert.deepEqual(view.attempts, { QUEUED: 1, SUPPRESSED_LAUNCH_GATE_CLOSED: 4 });
    const inventory = view.gates.find((row) => row.gateKey === 'inventory')!;
    assert.equal(inventory.queued.count, 1);
    assert.equal(inventory.inFlight.count, 1);
    assert.equal(inventory.unknownOutcome.count, 0);
    assert.ok(inventory.queued.oldestAgeSec! >= 119);

    const crm = view.gates.find((row) => row.gateKey === 'crm')!;
    assert.equal(crm.unknownOutcome.count, 1);
    assert.equal(crm.queued.count, 0);

    // A route nothing stamped reports a real zero, not a fabricated one.
    const untouched = view.gates.find((row) => row.gateKey === 'reports')!;
    assert.deepEqual(untouched.queued, { count: 0, oldestAgeSec: null });
  });

  it('reports an empty attempts map rather than inventing statuses when none exist', async () => {
    const view = await new GetLaunchHealthUseCase(makePrisma()).execute();
    assert.deepEqual(view.attempts, {});
    assert.deepEqual(view.gates[0]!.inFlight, { count: 0, oldestAgeSec: null });
  });

  it('lists namespace rows as unmaterialized with their reason, never as gate rows', async () => {
    const view = await new GetLaunchHealthUseCase(makePrisma()).execute();

    assert.equal(view.unmaterializedMatrixRows.length, NON_MATERIALIZABLE_LAUNCH_MATRIX_ROWS.length);
    assert.equal(view.unmaterializedMatrixRows.length, 2);
    for (const row of view.unmaterializedMatrixRows) {
      assert.ok(row.reason.length > 0);
      assert.ok(!view.gates.some((gate) => gate.gateKey === row.gateKey && gate.routeKey === row.routeKey));
    }
  });
});

describe('GetLaunchHealthUseCase — durable shadow evidence (runbook §2.1 counts.wouldBlock)', () => {
  it('reports real would_block counts against the exact route the observation named', async () => {
    const view = await new GetLaunchHealthUseCase(makePrisma({
      buckets: [
        bucket({ gateKey: 'crm', reason: 'available', wouldBlock: false, observedCount: 40 }),
        bucket({ gateKey: 'crm', reason: 'feature_disabled', wouldBlock: true, observedCount: 7 }),
        bucket({ gateKey: 'inventory', reason: 'launch_gate_closed', wouldBlock: true, observedCount: 3 }),
      ],
    })).execute();

    const crm = view.gates.find((row) => row.gateKey === 'crm')!;
    assert.equal(crm.counts.wouldBlock, 7);
    assert.equal(crm.shadow.observed, 47);
    assert.deepEqual(crm.shadow.byReason, { available: 40, feature_disabled: 7 });

    const inventory = view.gates.find((row) => row.gateKey === 'inventory')!;
    assert.equal(inventory.counts.wouldBlock, 3);
    assert.equal(inventory.shadow.observed, 3);
  });

  it('distinguishes "0 blocks out of many observations" from "0 blocks because nothing ran"', async () => {
    const view = await new GetLaunchHealthUseCase(makePrisma({
      buckets: [bucket({ gateKey: 'crm', reason: 'available', wouldBlock: false, observedCount: 5_000 })],
    })).execute();

    const measured = view.gates.find((row) => row.gateKey === 'crm')!;
    const unmeasured = view.gates.find((row) => row.gateKey === 'reports')!;

    // Same wouldBlock. Only `observed` separates evidence from an absence of measurement, which is
    // the precondition R1 step 2 actually depends on.
    assert.equal(measured.counts.wouldBlock, 0);
    assert.equal(unmeasured.counts.wouldBlock, 0);
    assert.equal(measured.shadow.observed, 5_000);
    assert.equal(unmeasured.shadow.observed, 0);
    assert.equal(unmeasured.shadow.hoursObserved, 0);
    assert.equal(unmeasured.shadow.lastObservedHourUtc, null);
  });

  it('counts distinct hours and surfaces so one burst cannot pass as continuous shadow', async () => {
    // Captured ONCE (r16 flake class): recomputing hourFloor in the assertion would compare a
    // different hour if the UTC clock ticks over mid-test; the fixture hours stay in-window.
    const fixtureHour = hourFloor(0);
    const priorHour = new Date(fixtureHour.getTime() - HOUR_MS);
    const view = await new GetLaunchHealthUseCase(makePrisma({
      buckets: [
        bucket({ hourStartUtc: fixtureHour, surface: 'outbox.drain', observedCount: 2 }),
        bucket({ hourStartUtc: priorHour, surface: 'outbox.drain', observedCount: 3 }),
        bucket({ hourStartUtc: priorHour, surface: 'crm.campaign.delivery', observedCount: 4 }),
      ],
    })).execute();

    const crm = view.gates.find((row) => row.gateKey === 'crm')!;
    assert.equal(crm.shadow.hoursObserved, 2);
    assert.deepEqual(crm.shadow.bySurface, { 'outbox.drain': 5, 'crm.campaign.delivery': 4 });
    assert.equal(crm.shadow.lastObservedHourUtc, fixtureHour.toISOString());
    assert.equal(view.shadowWindow.hoursObserved, 2);
  });

  it('reads only this environment, across every build in the window', async () => {
    let queried: any;
    const view = await new GetLaunchHealthUseCase(makePrisma({
      onBucketQuery: (args) => { queried = args; },
      buckets: [
        bucket({ buildReleaseId: 'build-a', observedCount: 5 }),
        bucket({ buildReleaseId: 'build-b', observedCount: 6 }),
      ],
    })).execute();

    // The environment filter is a WHERE clause, not a post-filter: cross-environment evidence must
    // never be fetched, let alone counted (spec CC1).
    assert.equal(queried.where.targetEnvironment, view.shadowWindow.environment);
    assert.ok(queried.where.hourStartUtc.gte instanceof Date);
    // A rolling deploy legitimately has two builds emitting in one hour; both count, both are named.
    assert.deepEqual(view.shadowWindow.builds, ['build-a', 'build-b']);
    assert.equal(view.gates.find((row) => row.gateKey === 'crm')!.shadow.observed, 11);
  });

  it('excludes future-dated evidence: an hour that has not happened yet is not evidence', async () => {
    const fixtureHour = hourFloor(0);
    let queried: any;
    const view = await new GetLaunchHealthUseCase(makePrisma({
      onBucketQuery: (args) => { queried = args; },
      buckets: [
        // Captured ONCE (r16): recomputing hourFloor(0) in the assertions below would flake if the
        // UTC hour ticks over mid-test — the fixture hour stays inside the window either way, so
        // the single capture is what the assertions must compare against.
        bucket({ hourStartUtc: fixtureHour, observedCount: 4 }),
        // A clock-skewed writer or a malformed insert. Counting it would let R1's "0 in the
        // observation window" be satisfied by an hour nobody has lived through yet.
        bucket({ hourStartUtc: new Date(fixtureHour.getTime() + 24 * HOUR_MS), reason: 'feature_disabled', wouldBlock: true, observedCount: 99 }),
      ],
    })).execute();

    // Bounded on BOTH sides, in the query — not filtered afterwards. The span assertion (23 hours
    // inclusive) proves both bounds come from ONE clock snapshot without racing the wall clock.
    assert.ok(queried.where.hourStartUtc.lte instanceof Date);
    assert.equal(queried.where.hourStartUtc.lte.getTime() - queried.where.hourStartUtc.gte.getTime(), 23 * HOUR_MS);

    const crm = view.gates.find((row) => row.gateKey === 'crm')!;
    assert.equal(crm.shadow.observed, 4);
    assert.equal(crm.counts.wouldBlock, 0, 'a future would_block must not count');
    assert.equal(crm.shadow.hoursObserved, 1);
    assert.equal(crm.shadow.lastObservedHourUtc, fixtureHour.toISOString());
    assert.equal(view.shadowWindow.observed, 4);
    assert.equal(view.shadowWindow.wouldBlock, 0);
    assert.ok(view.shadowWindow.hoursObserved <= view.shadowWindow.windowHours);
    assert.equal(view.shadowWindow.hoursObserved, 1);
  });

  it('excludes evidence older than the window and evidence from another environment', async () => {
    const view = await new GetLaunchHealthUseCase(makePrisma({
      buckets: [
        bucket({ hourStartUtc: hourFloor(0), observedCount: 6 }),
        // One hour past the 24h window (the window spans hours 0..23 inclusive).
        bucket({ hourStartUtc: hourFloor(24), reason: 'feature_disabled', wouldBlock: true, observedCount: 50 }),
        // Attested elsewhere: a uat observation never authorized this environment (spec CC1).
        bucket({ targetEnvironment: 'somewhere-else', reason: 'feature_disabled', wouldBlock: true, observedCount: 70 }),
      ],
    })).execute();

    const crm = view.gates.find((row) => row.gateKey === 'crm')!;
    assert.equal(crm.shadow.observed, 6);
    assert.equal(crm.counts.wouldBlock, 0);
    assert.equal(view.shadowWindow.observed, 6);
    assert.equal(view.shadowWindow.environment, CURRENT_ENV);
    assert.deepEqual(view.shadowWindow.builds, ['build-a']);
  });

  it('expresses coverage without any tenant dimension', async () => {
    const view = await new GetLaunchHealthUseCase(makePrisma({
      buckets: [
        bucket({ gateKey: 'inventory', reason: 'launch_gate_closed', wouldBlock: true, observedCount: 2 }),
        bucket({ gateKey: 'crm', reason: 'available', observedCount: 6 }),
        // A second bucket for the same route is evidence volume, not another observed route.
        bucket({ gateKey: 'crm', surface: 'crm.campaign.delivery', reason: 'available', observedCount: 4 }),
        // Unmapped observations are coverage, not a route: they never attach to a gate row.
        bucket({ gateKey: '__unmapped__', reason: 'unmapped_feature', observedCount: 5 }),
      ],
    })).execute();

    assert.equal(view.shadowWindow.observed, 17);
    assert.equal(view.shadowWindow.mapped, 12);
    assert.equal(view.shadowWindow.wouldBlock, 2);
    assert.deepEqual(view.shadowWindow.observedRoutes, [
      { gateKey: 'crm', routeKey: 'DEFAULT' },
      { gateKey: 'inventory', routeKey: 'DEFAULT' },
    ]);
    assert.deepEqual(view.evidenceTracks.async, { catalogComplete: 13, observed: 2, required: 13 });
    assert.equal(view.shadowWindow.windowHours, 24);
    assert.deepEqual(view.shadowWindow.unmappedBySurface, { 'outbox.drain': 5 });
    assert.deepEqual(view.shadowWindow.bySurface, {
      'crm.campaign.delivery': { observed: 4, mapped: 4, wouldBlock: 0 },
      'outbox.drain': { observed: 13, mapped: 8, wouldBlock: 2 },
    });

    // The sentinel is never rendered as if it were a launch route.
    assert.ok(!view.gates.some((row) => row.gateKey === '__unmapped__'));
    // And no tenant-shaped field exists to leak: coverage is observations, hours, routes, surfaces.
    assert.ok(!JSON.stringify(view.shadowWindow).includes('compan'));
  });
});

describe('GetLaunchHealthUseCase — row type B (runbook §2.2)', () => {
  it('aggregates ON/OFF counts per featureKey', async () => {
    const view = await new GetLaunchHealthUseCase(makePrisma({
      grouped: [
        { featureKey: 'crm', enabled: true, _count: { _all: 3 } },
        { featureKey: 'crm', enabled: false, _count: { _all: 1 } },
        { featureKey: 'inventory', enabled: true, _count: { _all: 2 } },
      ],
    })).execute();

    assert.deepEqual(
      view.featureLifecycle.map((row) => [row.featureKey, row.companiesOn, row.companiesDraining, row.companiesOff]),
      [['crm', 3, 0, 1], ['inventory', 2, 0, 0]],
    );
  });

  it('derives DRAINING from the latest DISABLE_REQUESTED transition, not a stored state', async () => {
    const view = await new GetLaunchHealthUseCase(makePrisma({
      // A draining company holds a DISABLED row: `enabled=false` lands in the DISABLE_REQUESTED
      // transaction so spec:60 rejects sends immediately. co-1 is that company; the other is a
      // genuinely live tenant.
      grouped: [
        { featureKey: 'crm', enabled: true, _count: { _all: 1 } },
        { featureKey: 'crm', enabled: false, _count: { _all: 1 } },
      ],
      drainRequests: [
        { companyId: 'co-1', featureKey: 'crm', seq: 7 },
        // Superseded: this company re-enabled afterwards, so its latest transition is not the request.
        { companyId: 'co-2', featureKey: 'crm', seq: 3 },
      ],
      fences: [
        { companyId: 'co-1', featureKey: 'crm', lastSeq: 7 },
        { companyId: 'co-2', featureKey: 'crm', lastSeq: 4 },
      ],
      snapshots: [{ companyId: 'co-1', featureKey: 'crm', disableSeq: 7, cutoffAt: new Date(), rootsJson: EMPTY_RUNOFF_ROOTS }],
    })).execute();

    // Counted exactly once, and subtracted from OFF — the draining row is a disabled row.
    assert.deepEqual(
      view.featureLifecycle.map((row) => [row.companiesOn, row.companiesDraining, row.companiesOff]),
      [[1, 1, 0]],
    );
  });

  it('reports drain age and current open membership instead of the stale stamped count (runbook §2.2 W3)', async () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 3_600_000);
    const view = await new GetLaunchHealthUseCase(makePrisma({
      grouped: [{ featureKey: 'crm', enabled: false, _count: { _all: 1 } }],
      drainRequests: [{ companyId: 'co-1', featureKey: 'crm', seq: 7, createdAt: threeHoursAgo }],
      fences: [{ companyId: 'co-1', featureKey: 'crm', lastSeq: 7 }],
      snapshots: [{ companyId: 'co-1', featureKey: 'crm', disableSeq: 7, cutoffAt: threeHoursAgo, rootsJson: EMPTY_RUNOFF_ROOTS }],
    })).execute();
    const row = view.featureLifecycle[0]!;

    assert.equal(row.drainingOpenItems, 0);
    assert.equal(row.drainingInspectionErrors, 0);
    assert.equal(row.drainingInspectionTruncated, false);
    assert.equal(row.oldestDrainingAgeHours, 3);
  });

  it('reports unreadable or uninspected drain state as unknown, never zero open items', async () => {
    const total = MAX_DRAINING_HEALTH_INSPECTIONS + 1;
    const drainRequests = Array.from({ length: total }, (_, index) => ({
      companyId: `co-${index}`,
      featureKey: 'crm',
      seq: 7,
    }));
    const view = await new GetLaunchHealthUseCase(makePrisma({
      grouped: [{ featureKey: 'crm', enabled: false, _count: { _all: total } }],
      drainRequests,
      fences: drainRequests.map((row) => ({ companyId: row.companyId, featureKey: row.featureKey, lastSeq: row.seq })),
      snapshots: drainRequests.map((row) => ({
        companyId: row.companyId,
        featureKey: row.featureKey,
        disableSeq: row.seq,
        cutoffAt: new Date(),
        rootsJson: EMPTY_RUNOFF_ROOTS,
      })),
    })).execute();
    const row = view.featureLifecycle[0]!;

    assert.equal(row.companiesDraining, total, 'DB aggregate remains exact past the inspection cap');
    assert.equal(row.drainingOpenItems, null);
    assert.equal(row.drainingInspectionErrors, 1);
    assert.equal(row.drainingInspectionTruncated, true);
  });

  it('reserves the CC7/F1.4 lifecycle metrics as null', async () => {
    const view = await new GetLaunchHealthUseCase(makePrisma({
      grouped: [{ featureKey: 'crm', enabled: true, _count: { _all: 1 } }],
    })).execute();
    const row = view.featureLifecycle[0]!;

    // `null`, not `0`: "nothing draining" and "draining with nothing left to do" are different
    // operator situations and R5 triages on the difference.
    assert.equal(row.oldestDrainingAgeHours, null);
    assert.equal(row.drainingOpenItems, null);
    assert.equal(row.drainingInspectionErrors, 0);
    // Still genuinely reserved — these describe RUNS of the reconciler, which nothing records
    // durably, so filling them would need a table and therefore a migration (ruling OQ-6).
    assert.equal(row.drainingReconcilerLastRunAt, null);
    assert.equal(row.reconcilerErrors, null);
    assert.equal(row.nullEpochPending, null);
    assert.equal(row.normalizationIncomplete, null);
    assert.deepEqual(row.backfill, { authorized: null, running: null, needsReview: null, failed: null, maxLagMin: null });
  });
});

describe('GetLaunchHealthUseCase — never-show list (runbook §2.3)', () => {
  it('emits no company identifier, no tenant identity and no per-tenant route state', async () => {
    const view = await new GetLaunchHealthUseCase(makePrisma({
      gates: [{ gateKey: 'crm', routeKey: 'DEFAULT', state: 'OPEN', generation: 1, lastSeq: 1, reason: null, updatedAt: new Date() }],
      grouped: [{ featureKey: 'crm', enabled: true, _count: { _all: 2 } }],
      drainRequests: [{ companyId: 'co-secret-1', featureKey: 'crm', seq: 7 }],
      fences: [{ companyId: 'co-secret-1', featureKey: 'crm', lastSeq: 7 }],
    })).execute();

    const serialized = JSON.stringify(view);
    assert.ok(!serialized.includes('co-secret-1'), 'no companyId may reach the health view');
    assert.ok(!serialized.includes('companyId'), 'no company-scoped field may reach the health view');
    assert.ok(!serialized.includes('companyName'));
    for (const row of view.featureLifecycle) {
      assert.deepEqual(
        Object.keys(row).filter((key) => key.toLowerCase().includes('company') && !key.startsWith('companies')),
        [],
      );
    }
  });
});

/**
 * Per-route shadow COVERAGE (piece 5). The buckets can say "no blocks were observed"; only the
 * catalog can say "and every surface that owns this family was actually looked at". R1 step 2 needs
 * both, so the view reports both.
 */
describe('GetLaunchHealthUseCase shadow coverage', () => {
  it('names the expected, observed and missing surfaces per route', async () => {
    const view = await new GetLaunchHealthUseCase(makePrisma({
      buckets: [
        bucket({ gateKey: 'workflow_automation', surface: 'outbox.drain', observedCount: 7 }),
        bucket({ gateKey: 'workflow_automation', surface: 'workflow.scan', observedCount: 3 }),
      ],
    })).execute();

    const workflow = view.gates.find((row) => row.gateKey === 'workflow_automation')!;
    assert.deepEqual([...workflow.shadow.surfacesExpected].sort(), [
      'outbox.drain', 'workflow.action.retry', 'workflow.events.ingest', 'workflow.scan', 'workflow.webhook.dispatch',
    ]);
    assert.deepEqual([...workflow.shadow.surfacesObserved].sort(), ['outbox.drain', 'workflow.scan']);
    // Instrumented but silent in this window — the exact case a bare `bySurface` cannot distinguish
    // from "not instrumented at all".
    assert.deepEqual([...workflow.shadow.surfacesMissing].sort(), [
      'workflow.action.retry', 'workflow.events.ingest', 'workflow.webhook.dispatch',
    ]);
    assert.equal(workflow.shadow.coverageComplete, true);
  });

  it('a zero-count bucket row is NOT observation — the surface stays missing', async () => {
    // `observedCount` defaults to 0 in the schema, so this row can exist without any work having
    // been measured. Deriving coverage from key presence would empty `surfacesMissing` here and
    // hand R1 a false-complete window.
    const view = await new GetLaunchHealthUseCase(makePrisma({
      buckets: [
        bucket({ gateKey: 'workflow_automation', surface: 'workflow.scan', observedCount: 0 }),
        bucket({ gateKey: 'workflow_automation', surface: 'outbox.drain', observedCount: 4 }),
        bucket({
          gateKey: 'crm', surface: 'crm.campaign.delivery', observedCount: 0,
          buildReleaseId: 'build-zero', hourStartUtc: hourFloor(1),
        }),
      ],
    })).execute();

    const workflow = view.gates.find((row) => row.gateKey === 'workflow_automation')!;
    assert.equal(workflow.shadow.bySurface['workflow.scan'], 0, 'the raw row is still reported');
    assert.deepEqual(workflow.shadow.surfacesObserved, ['outbox.drain']);
    assert.ok(workflow.shadow.surfacesMissing.includes('workflow.scan'));
    assert.deepEqual(view.shadowWindow.observedRoutes, [
      { gateKey: 'workflow_automation', routeKey: 'DEFAULT' },
    ]);
    assert.deepEqual(view.shadowWindow.builds, ['build-a']);
    assert.equal(view.shadowWindow.hoursObserved, 1);
    assert.deepEqual(view.evidenceTracks.async, { catalogComplete: 13, observed: 1, required: 13 });
  });

  it('an unexpected surface name cannot reduce surfacesMissing', async () => {
    // Instrumenting the wrong name must never satisfy the coverage bar for the right one; the raw
    // count is still visible in `bySurface` so the typo is diagnosable.
    const view = await new GetLaunchHealthUseCase(makePrisma({
      buckets: [bucket({ gateKey: 'workflow_automation', surface: 'workflow.scans', observedCount: 99 })],
    })).execute();

    const workflow = view.gates.find((row) => row.gateKey === 'workflow_automation')!;
    assert.equal(workflow.shadow.bySurface['workflow.scans'], 99);
    assert.deepEqual(workflow.shadow.surfacesObserved, []);
    assert.equal(workflow.shadow.surfacesMissing.length, workflow.shadow.surfacesExpected.length);
  });

  it('reports catalog coverage independently from whether this window observed work', async () => {
    const view = await new GetLaunchHealthUseCase(makePrisma({ buckets: [] })).execute();
    const crm = view.gates.find((row) => row.gateKey === 'crm')!;
    assert.equal(crm.shadow.coverageComplete, true);
    assert.deepEqual([...crm.shadow.surfacesExpected].sort(), [
      'crm.campaign.delivery',
      'crm.inbox.retry',
      'crm.newconv.scan',
      'crm.sla.scan',
      'outbox.drain',
    ]);
    assert.deepEqual(crm.shadow.surfacesObserved, []);
    assert.deepEqual([...crm.shadow.surfacesMissing].sort(), [
      'crm.campaign.delivery',
      'crm.inbox.retry',
      'crm.newconv.scan',
      'crm.sla.scan',
      'outbox.drain',
    ]);
  });

  it('expects nothing on a route no async surface feeds', async () => {
    const view = await new GetLaunchHealthUseCase(makePrisma({ buckets: [] })).execute();
    const wht = view.gates.find((row) => row.routeKey === 'SYSTEM_INITIAL_ISSUE')!;
    assert.deepEqual(wht.shadow.surfacesExpected, []);
    assert.deepEqual(wht.shadow.surfacesObserved, []);
    assert.deepEqual(wht.shadow.surfacesMissing, []);

    // `reports` is the released family and has zero async rows: nothing expected, nothing missing,
    // and `coverageComplete` is false because the question does not apply — read together.
    const reports = view.gates.find((row) => row.gateKey === 'reports')!;
    assert.deepEqual(reports.shadow.surfacesExpected, []);
    assert.equal(reports.shadow.coverageComplete, false);
  });
});
