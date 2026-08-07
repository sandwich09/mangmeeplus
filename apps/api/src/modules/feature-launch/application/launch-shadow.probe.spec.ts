import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  LAUNCH_SHADOW_EVENT,
  LAUNCH_SHADOW_PERSIST_FAILED_EVENT,
  LAUNCH_SHADOW_READ_FAILED_EVENT,
  LaunchShadowProbe,
  SHADOW_BLOCKING_REASONS,
  UNMAPPED_GATE_KEY,
  shadowBucketHour,
} from './launch-shadow.probe';

function makeProbe(opts: {
  gates?: Array<{ gateKey: string; routeKey: string; state: string; generation: number }>;
  entitlementsByCompany?: Record<string, Array<{ featureKey: string; enabled: boolean }>>;
  upsertThrows?: boolean;
  gateReadThrows?: boolean;
  entitlementReadThrows?: boolean;
  /** The exact error the entitlement read should throw — used to plant a tenant-bearing message. */
  entitlementReadError?: Error;
  loggerThrows?: boolean;
} = {}) {
  const reads = { gates: 0, entitlements: 0 };
  const logs: any[] = [];
  const warns: any[] = [];
  const upserts: any[] = [];
  const prisma = {
    client: {
      featureLaunchGate: {
        findMany: async () => {
          reads.gates += 1;
          if (opts.gateReadThrows) throw new Error('GATE_READ_DOWN');
          return opts.gates ?? [];
        },
      },
      companyFeatureEntitlement: {
        findMany: async (args: any) => {
          reads.entitlements += 1;
          if (opts.entitlementReadError) throw opts.entitlementReadError;
          if (opts.entitlementReadThrows) throw new Error('ENTITLEMENT_READ_DOWN');
          return opts.entitlementsByCompany?.[args.where.companyId] ?? [];
        },
      },
      featureLaunchObservationBucket: {
        upsert: async (args: any) => {
          if (opts.upsertThrows) throw new Error('DB_DOWN');
          upserts.push(args);
          return { id: 'bucket-1' };
        },
      },
    },
  } as any;
  const logger = {
    info: (payload: any) => {
      if (opts.loggerThrows) throw new Error('LOGGER_DOWN');
      logs.push(payload);
    },
    warn: (payload: any) => {
      if (opts.loggerThrows) throw new Error('LOGGER_DOWN');
      warns.push(payload);
    },
    error: () => {},
  } as any;
  return { probe: new LaunchShadowProbe(prisma, logger), reads, logs, warns, upserts };
}

/** The durable shape one upsert asks for, flattened for readable assertions. */
const bucketOf = (call: any) => ({
  ...call.where.bucketKey,
  created: call.create.observedCount,
  increment: call.update.observedCount.increment,
});

const OPEN_CRM = [{ gateKey: 'crm', routeKey: 'DEFAULT', state: 'OPEN', generation: 1 }];

describe('LaunchShadowProbe', () => {
  it('records available when the company is entitled and the route is OPEN', async () => {
    const { probe, logs } = makeProbe({
      gates: OPEN_CRM,
      entitlementsByCompany: { 'co-1': [{ featureKey: 'crm', enabled: true }] },
    });
    const decision = await probe.startSweep('test.surface').record('co-1', 'crm');
    assert.deepEqual(decision, { wouldBlock: false, reason: 'available' });
    assert.equal(logs[0].event, LAUNCH_SHADOW_EVENT);
    assert.deepEqual(
      { surface: logs[0].surface, featureKey: logs[0].featureKey, wouldBlock: logs[0].wouldBlock },
      { surface: 'test.surface', featureKey: 'crm', wouldBlock: false },
    );
  });

  it('records would_block for a disabled feature and for a closed or absent route', async () => {
    const disabled = makeProbe({ gates: OPEN_CRM, entitlementsByCompany: { 'co-1': [{ featureKey: 'crm', enabled: false }] } });
    assert.deepEqual(await disabled.probe.startSweep('s').record('co-1', 'crm'), { wouldBlock: true, reason: 'feature_disabled' });

    const closed = makeProbe({
      gates: [{ gateKey: 'crm', routeKey: 'DEFAULT', state: 'CLOSED', generation: 2 }],
      entitlementsByCompany: { 'co-1': [{ featureKey: 'crm', enabled: true }] },
    });
    assert.deepEqual(await closed.probe.startSweep('s').record('co-1', 'crm'), { wouldBlock: true, reason: 'launch_gate_closed' });

    // An unseeded route reads as CLOSED, exactly like LaunchGateGuardService and the schema default.
    const absent = makeProbe({ gates: [], entitlementsByCompany: { 'co-1': [{ featureKey: 'crm', enabled: true }] } });
    assert.deepEqual(await absent.probe.startSweep('s').record('co-1', 'crm'), { wouldBlock: true, reason: 'launch_gate_closed' });
  });

  it('does not guess at an unmapped feature', async () => {
    const { probe } = makeProbe({ gates: OPEN_CRM });
    assert.deepEqual(await probe.startSweep('s').record('co-1', null), { wouldBlock: false, reason: 'unmapped_feature' });
  });

  it('passes the legacy fail-open cohort (a company with no entitlement rows at all)', async () => {
    const { probe } = makeProbe({ gates: OPEN_CRM, entitlementsByCompany: { 'co-1': [] } });
    assert.deepEqual(await probe.startSweep('s').record('co-1', 'crm'), { wouldBlock: false, reason: 'available' });
  });

  it('loads gates once and each company once per sweep', async () => {
    const { probe, reads } = makeProbe({
      gates: OPEN_CRM,
      entitlementsByCompany: {
        'co-1': [{ featureKey: 'crm', enabled: true }],
        'co-2': [{ featureKey: 'crm', enabled: false }],
      },
    });
    const sweep = probe.startSweep('s');
    for (let i = 0; i < 5; i++) {
      await sweep.record('co-1', 'crm');
      await sweep.record('co-2', 'crm');
    }
    assert.deepEqual(reads, { gates: 1, entitlements: 2 });
    assert.deepEqual(await sweep.flush(), { available: 5, feature_disabled: 5 });

    // A new sweep re-reads: memoization is planning-only and never spans sweeps (spec:60).
    await probe.startSweep('s').record('co-1', 'crm');
    assert.deepEqual(reads, { gates: 2, entitlements: 3 });
  });
});

describe('LaunchShadowSweep — durable observation buckets (r2 ruling)', () => {
  it('folds a sweep into one hourly bucket per (gate, route, reason) with summed counts', async () => {
    const { probe, upserts } = makeProbe({
      gates: OPEN_CRM,
      entitlementsByCompany: {
        'co-1': [{ featureKey: 'crm', enabled: true }],
        'co-2': [{ featureKey: 'crm', enabled: false }],
      },
    });
    const sweep = probe.startSweep('crm.campaign.delivery');
    for (let i = 0; i < 3; i++) await sweep.record('co-1', 'crm');
    for (let i = 0; i < 2; i++) await sweep.record('co-2', 'crm');
    await sweep.flush();

    // Two distinct reasons on one route = two rows, NOT five writes: the sweep buffers.
    assert.equal(upserts.length, 2);
    const rows = upserts.map(bucketOf).sort((a, b) => a.reason.localeCompare(b.reason));
    assert.deepEqual(
      rows.map((row) => ({ gateKey: row.gateKey, routeKey: row.routeKey, reason: row.reason, wouldBlock: row.wouldBlock, created: row.created, increment: row.increment })),
      [
        { gateKey: 'crm', routeKey: 'DEFAULT', reason: 'available', wouldBlock: false, created: 3, increment: 3 },
        { gateKey: 'crm', routeKey: 'DEFAULT', reason: 'feature_disabled', wouldBlock: true, created: 2, increment: 2 },
      ],
    );
    for (const row of rows) {
      assert.equal(row.surface, 'crm.campaign.delivery');
      assert.equal(row.hourStartUtc.getTime(), shadowBucketHour().getTime());
      // Server-derived deployment identity, never a caller value.
      assert.equal(typeof row.targetEnvironment, 'string');
      assert.equal(typeof row.buildReleaseId, 'string');
    }
  });

  it('carries no companyId or other tenant identity into the durable row', async () => {
    const { probe, upserts } = makeProbe({
      gates: OPEN_CRM,
      entitlementsByCompany: { 'co-secret': [{ featureKey: 'crm', enabled: false }] },
    });
    const sweep = probe.startSweep('outbox.drain');
    await sweep.record('co-secret', 'crm');
    await sweep.flush();

    const serialized = JSON.stringify(upserts);
    assert.equal(serialized.includes('co-secret'), false);
    assert.equal(serialized.includes('companyId'), false);
    assert.deepEqual(
      Object.keys(upserts[0].where.bucketKey).sort(),
      ['buildReleaseId', 'gateKey', 'hourStartUtc', 'reason', 'routeKey', 'surface', 'targetEnvironment', 'wouldBlock'],
    );
  });

  it('stores wouldBlock alongside the reason it was derived from, for every reason', async () => {
    const { probe, upserts } = makeProbe({
      gates: [{ gateKey: 'crm', routeKey: 'DEFAULT', state: 'CLOSED', generation: 1 }],
      entitlementsByCompany: { 'co-1': [{ featureKey: 'crm', enabled: true }] },
    });
    const sweep = probe.startSweep('outbox.drain');
    await sweep.record('co-1', 'crm'); // launch_gate_closed
    await sweep.record(null, 'crm'); // launch_gate_closed too — the gate is shut for everyone
    await sweep.record('co-1', null); // unmapped_feature
    await sweep.flush();

    for (const row of upserts.map(bucketOf)) {
      assert.equal(row.wouldBlock, SHADOW_BLOCKING_REASONS.has(row.reason), `reason ${row.reason}`);
    }
  });

  it('books an unmapped observation under the sentinel gate rather than guessing a route', async () => {
    const { probe, upserts } = makeProbe({ gates: OPEN_CRM });
    const sweep = probe.startSweep('outbox.drain');
    await sweep.record('co-1', null);
    await sweep.flush();

    const row = bucketOf(upserts[0]);
    assert.equal(row.gateKey, UNMAPPED_GATE_KEY);
    assert.equal(row.reason, 'unmapped_feature');
    assert.equal(row.wouldBlock, false);
  });

  it('writes nothing when a sweep observed nothing', async () => {
    const { probe, upserts, logs } = makeProbe({ gates: OPEN_CRM });
    assert.deepEqual(await probe.startSweep('outbox.drain').flush(), {});
    assert.equal(upserts.length, 0);
    assert.equal(logs.length, 0);
  });

  it('never lets a persist failure escape into the surface it measures', async () => {
    const { probe, warns } = makeProbe({
      gates: OPEN_CRM,
      entitlementsByCompany: { 'co-1': [{ featureKey: 'crm', enabled: true }] },
      upsertThrows: true,
    });
    const sweep = probe.startSweep('outbox.drain');
    await sweep.record('co-1', 'crm');

    // Resolves, returns the summary anyway, and leaves a visible warn — a drain must not fail
    // because its measurement could not be written.
    assert.deepEqual(await sweep.flush(), { available: 1 });
    assert.equal(warns.length, 1);
    assert.equal(warns[0].event, LAUNCH_SHADOW_PERSIST_FAILED_EVENT);
    // The raw message is GONE by design; the class survives as triage signal.
    assert.equal(warns[0].error, undefined);
    assert.equal(warns[0].errorCategory, 'Error');
  });
});

/**
 * The probe contract, stated as tests (codex r23 F1/F2).
 *
 * The probe measures a surface; it may never change one. Every failure mode it can have — gate read,
 * entitlement read, persist, and the narration of any of those — must terminate inside the probe.
 */
describe('LaunchShadowProbe never throws and never names a tenant', () => {
  it('survives a gate-read failure: no bucket, no throw, one distinct warn', async () => {
    const { probe, upserts, warns } = makeProbe({ gateReadThrows: true });
    const sweep = probe.startSweep('outbox.drain');

    const decision = await sweep.record('co-1', 'crm');

    // A failed read is NOT evidence — nothing is buffered, so no bucket row can claim this
    // observation happened and R1 cannot read an outage as a clean window.
    assert.deepEqual(decision, { wouldBlock: false, reason: 'read_failed' });
    assert.deepEqual(await sweep.flush(), {});
    assert.equal(upserts.length, 0);
    assert.equal(warns.length, 1);
    assert.equal(warns[0].event, LAUNCH_SHADOW_READ_FAILED_EVENT);
    assert.equal(warns[0].error, undefined);
    assert.equal(warns[0].errorCategory, 'Error');
  });

  it('survives an entitlement-read failure the same way', async () => {
    const { probe, upserts, warns } = makeProbe({ entitlementReadThrows: true });
    const sweep = probe.startSweep('crm.sla.scan');

    assert.deepEqual(await sweep.record('co-1', 'crm'), { wouldBlock: false, reason: 'read_failed' });
    await sweep.flush();
    assert.equal(upserts.length, 0);
    assert.equal(warns[0].event, LAUNCH_SHADOW_READ_FAILED_EVENT);
    assert.equal(warns[0].error, undefined);
    assert.equal(warns[0].errorCategory, 'Error');
  });

  it('read_failed is never a blocking reason and is never persisted', () => {
    // If it ever entered SHADOW_BLOCKING_REASONS, an outage would manufacture would_block evidence.
    assert.equal(SHADOW_BLOCKING_REASONS.has('read_failed' as never), false);
  });

  it('survives a logger that throws, on both the per-item line and the summary', async () => {
    const { probe, upserts } = makeProbe({
      gates: OPEN_CRM,
      entitlementsByCompany: { 'co-1': [{ featureKey: 'crm', enabled: true }] },
      loggerThrows: true,
    });
    const sweep = probe.startSweep('outbox.drain');

    // A failed LOG keeps the observation: the measurement is real, only its narration was lost.
    assert.deepEqual(await sweep.record('co-1', 'crm'), { wouldBlock: false, reason: 'available' });
    assert.deepEqual(await sweep.flush(), { available: 1 });
    assert.equal(upserts.length, 1);
  });

  it('survives a persist failure whose own warn also throws', async () => {
    const { probe } = makeProbe({
      gates: OPEN_CRM,
      entitlementsByCompany: { 'co-1': [{ featureKey: 'crm', enabled: true }] },
      upsertThrows: true,
      loggerThrows: true,
    });
    const sweep = probe.startSweep('outbox.drain');
    await sweep.record('co-1', 'crm');
    // Both the write and the report of the write failed; the caller still gets its summary back.
    assert.deepEqual(await sweep.flush(), { available: 1 });
  });

  it('puts no companyId in any structured log line (F2 regression guard)', async () => {
    const { probe, logs, warns } = makeProbe({
      gates: OPEN_CRM,
      entitlementsByCompany: { 'co-secret': [{ featureKey: 'crm', enabled: false }] },
    });
    const sweep = probe.startSweep('outbox.drain');
    await sweep.record('co-secret', 'crm');
    await sweep.record(null, 'crm');
    await sweep.flush();

    // Serialized, so a nested or renamed field cannot smuggle the tenant back in.
    const serialized = JSON.stringify([...logs, ...warns]);
    assert.equal(serialized.includes('co-secret'), false);
    assert.equal(serialized.includes('companyId'), false);
    for (const line of logs) assert.equal('companyId' in line, false);
  });

  it('keeps naming the surface, feature, route and decision — the tenant is the only thing removed', async () => {
    const { probe, logs } = makeProbe({
      gates: OPEN_CRM,
      entitlementsByCompany: { 'co-1': [{ featureKey: 'crm', enabled: false }] },
    });
    const sweep = probe.startSweep('ai.draft.drain');
    await sweep.record('co-1', 'crm');
    await sweep.flush();

    assert.deepEqual(
      { surface: logs[0].surface, featureKey: logs[0].featureKey, routeKey: logs[0].routeKey, wouldBlock: logs[0].wouldBlock, reason: logs[0].reason },
      { surface: 'ai.draft.drain', featureKey: 'crm', routeKey: 'DEFAULT', wouldBlock: true, reason: 'feature_disabled' },
    );
    assert.equal(logs[1].event, `${LAUNCH_SHADOW_EVENT}.summary`);
    assert.equal(logs[1].feature_disabled, 1);
  });
});

/**
 * The warn path is the one that fires during an incident, and it was the last place a tenant value
 * could reach the central log index (codex r24). A successful sweep emits no warns at all, so the
 * absence assertions above could never have covered this path — it needs its own test with a
 * deliberately hostile exception message.
 */
describe('LaunchShadowProbe warn payloads carry no tenant text', () => {
  /** Exactly the shape a driver or repository is free to produce. */
  const LEAKY = new Error('entitlement read failed for companyId co-secret-tenant-42');

  it('drops the raw message when an entitlement read throws a tenant-bearing error', async () => {
    const { probe, warns, upserts, logs } = makeProbe({ gates: OPEN_CRM, entitlementReadError: LEAKY });
    const sweep = probe.startSweep('notifications.delivery.sweep');

    // Business flow continues: the probe resolves rather than throwing, so the caller's sweep runs on.
    const decision = await sweep.record('co-secret-tenant-42', 'crm');
    assert.deepEqual(decision, { wouldBlock: false, reason: 'read_failed' });
    assert.deepEqual(await sweep.flush(), {});

    // A failed read is not evidence.
    assert.equal(upserts.length, 0);

    // The warn IS emitted — dropping the leak must not cost ops the signal.
    assert.equal(warns.length, 1);
    assert.equal(warns[0].event, LAUNCH_SHADOW_READ_FAILED_EVENT);

    // Serialized, so a nested field cannot carry the message either.
    const serialized = JSON.stringify([...warns, ...logs]);
    assert.equal(serialized.includes('companyId'), false);
    assert.equal(serialized.includes('co-secret-tenant-42'), false);
    assert.equal(serialized.includes('entitlement read failed'), false);
  });

  it('keeps the triage signal ops actually needs', async () => {
    const { probe, warns } = makeProbe({ gates: OPEN_CRM, entitlementReadError: LEAKY });
    await probe.startSweep('notifications.delivery.sweep').record('co-secret-tenant-42', 'crm');

    assert.deepEqual(
      {
        event: warns[0].event,
        surface: warns[0].surface,
        featureKey: warns[0].featureKey,
        routeKey: warns[0].routeKey,
        errorCategory: warns[0].errorCategory,
      },
      {
        event: LAUNCH_SHADOW_READ_FAILED_EVENT,
        // The surface is a code constant, never tenant-bearing.
        surface: 'notifications.delivery.sweep',
        featureKey: 'crm',
        routeKey: 'DEFAULT',
        errorCategory: 'Error',
      },
    );
  });

  it('keeps a driver code, because P1001 and P2002 are different incidents', async () => {
    const prismaLike = Object.assign(new Error('Can\'t reach database server at co-secret-host'), { code: 'P1001' });
    const { probe, warns } = makeProbe({ gates: OPEN_CRM, entitlementReadError: prismaLike });
    await probe.startSweep('outbox.drain').record('co-secret-tenant-42', 'crm');

    assert.equal(warns[0].errorCode, 'P1001');
    assert.equal(JSON.stringify(warns).includes('co-secret-host'), false);
  });

  it('refuses a code that is really a message', async () => {
    // A library that stuffs free text into `.code` must not get a free channel into the log index.
    const chatty = Object.assign(new Error('boom'), { code: 'failed for companyId co-secret-tenant-42' });
    const { probe, warns } = makeProbe({ gates: OPEN_CRM, entitlementReadError: chatty });
    await probe.startSweep('outbox.drain').record('co-secret-tenant-42', 'crm');

    assert.equal(warns[0].errorCode, undefined);
    assert.equal(JSON.stringify(warns).includes('co-secret-tenant-42'), false);
  });

  it('names a non-Error throw by its type rather than stringifying it', async () => {
    const { probe, warns } = makeProbe({ gates: OPEN_CRM, entitlementReadError: 'co-secret-tenant-42' as never });
    await probe.startSweep('outbox.drain').record('co-secret-tenant-42', 'crm');

    assert.equal(warns[0].errorCategory, 'string');
    assert.equal(JSON.stringify(warns).includes('co-secret-tenant-42'), false);
  });
});
