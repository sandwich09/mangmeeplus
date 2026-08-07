/**
 * REAL-DATABASE spec for the `FeatureLaunchObservationBucket` counter write.
 *
 * The invariant here is invisible to a mocked test: a fake `upsert` cannot lose an increment, so
 * only two real connections racing the same bucket key can prove the write is a single atomic
 * `INSERT … ON CONFLICT DO UPDATE` rather than a read-modify-write (which would silently drop
 * counts) or a create-then-catch (which would raise P2002 at the loser).
 *
 * `launch-shadow.probe.spec.ts` pins the fold LOGIC against a double; this pins the CONCURRENCY
 * behaviour against the database. It is also the regression guard for the schema rule that this
 * table carries exactly ONE unique index: `ON CONFLICT` arbitrates on one index, so a second unique
 * added later would make the loser reach a non-arbiter index and raise unique_violation instead of
 * incrementing — which shows up here as a rejected flush.
 *
 * SKIPS (never fails) when no database is reachable, so the suite still exits 0 without one.
 *
 * Safety: every row it writes carries a pid-scoped `surface`, so it collides with nothing and with
 * no other run, and it is deleted afterwards. It writes to no other table.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../../generated/prisma/client';
import { LaunchShadowProbe, shadowBucketHour } from './launch-shadow.probe';

/** Its own surface namespace, so the rows this file writes are unmistakably its own. */
const SURFACE = `shadow-bucket-${process.pid}`;
const GATE_KEY = `shadow-bucket-gate-${process.pid}`;

/** Sweeps racing one bucket key, and observations each folds into it. */
const SWEEPS = 8;
const OBSERVATIONS_PER_SWEEP = 25;

/**
 * The ROOT `.env` is the real local database (docker `127.0.0.1:15432/watchdog_bms`).
 * `apps/api/.env` carries a stale `5432/mydb` URL that only the Prisma CLI should ever see.
 */
function rootDatabaseUrl(): string | null {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const env = readFileSync(join(__dirname, '../'.repeat(6), '.env'), 'utf8');
    return /^DATABASE_URL\s*=\s*"?([^"\n]+)"?/m.exec(env)?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * The probe swallows persist failures by design, so a database error would otherwise be invisible
 * here and every "it did not reject" assertion would be vacuous. Capturing the warn is what makes a
 * swallowed unique_violation a test failure.
 */
const persistFailures: any[] = [];
const capturingLogger = { warn: (payload: any) => persistFailures.push(payload), info() {}, error() {} } as any;

describe('FeatureLaunchObservationBucket counter (real database)', () => {
  let clients: PrismaClient[] = [];
  let probes: LaunchShadowProbe[] = [];
  let reachable = false;

  const cleanup = async () => {
    await clients[0]!.featureLaunchObservationBucket.deleteMany({ where: { surface: SURFACE } });
  };

  before(async () => {
    const url = rootDatabaseUrl();
    if (!url) return;
    try {
      clients = Array.from(
        { length: SWEEPS },
        () => new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) }),
      );
      await clients[0]!.$queryRaw`SELECT 1`;
      reachable = true;
    } catch {
      reachable = false;
      return;
    }
    // An OPEN gate on this file's own key, so every observation resolves to one 'available' bucket.
    await clients[0]!.featureLaunchGate.upsert({
      where: { gateKey_routeKey: { gateKey: GATE_KEY, routeKey: 'DEFAULT' } },
      create: { gateKey: GATE_KEY, routeKey: 'DEFAULT', state: 'OPEN', generation: 1 },
      update: { state: 'OPEN' },
    });
    probes = clients.map((client) => new LaunchShadowProbe({ client } as any, capturingLogger));
    await cleanup();
  });

  after(async () => {
    if (!reachable) return;
    await cleanup();
    await clients[0]!.featureLaunchGate.deleteMany({ where: { gateKey: GATE_KEY } });
    await Promise.all(clients.map((client) => client.$disconnect()));
  });

  /** One sweep on its own connection: N observations of the same route, then one flush. */
  async function runSweep(index: number): Promise<void> {
    const sweep = probes[index]!.startSweep(SURFACE);
    for (let i = 0; i < OBSERVATIONS_PER_SWEEP; i++) {
      // companyId null: the entitlement half is skipped, so every observation lands on the same
      // (gate, route, reason) bucket and the assertion is purely about the counter.
      await sweep.record(null, GATE_KEY);
    }
    await sweep.flush();
  }

  it('loses no increment when every sweep folds into the same bucket concurrently', async (t) => {
    if (!reachable) return t.skip('no database reachable');

    persistFailures.length = 0;
    await Promise.all(Array.from({ length: SWEEPS }, (_, index) => runSweep(index)));

    assert.deepEqual(persistFailures, [], 'no fold may fail: the counter write must survive the race');
    const rows = await clients[0]!.featureLaunchObservationBucket.findMany({ where: { surface: SURFACE } });
    assert.equal(rows.length, 1, 'concurrent folds must converge on ONE row, not one row per racer');
    assert.equal(
      rows[0]!.observedCount,
      SWEEPS * OBSERVATIONS_PER_SWEEP,
      'every observation must survive: a lost increment means the write is not atomic',
    );
    assert.equal(rows[0]!.gateKey, GATE_KEY);
    assert.equal(rows[0]!.reason, 'no_company');
    assert.equal(rows[0]!.wouldBlock, false);
    assert.equal(rows[0]!.hourStartUtc.getTime(), shadowBucketHour().getTime());
  });

  it('never raises a unique violation at the loser of a concurrent first insert', async (t) => {
    if (!reachable) return t.skip('no database reachable');

    // The dangerous moment is the FIRST write to a key: both racers speculate an insert, and only
    // one can win. Repeated on a fresh key each round so no round is decided by an existing row.
    for (let round = 0; round < 25; round++) {
      await cleanup();
      persistFailures.length = 0;
      await Promise.all([runSweep(0), runSweep(1)]);
      // A unique_violation would be swallowed by the probe, so the warn is the evidence.
      assert.deepEqual(persistFailures, [], `round ${round} failed to persist a fold`);

      const rows = await clients[0]!.featureLaunchObservationBucket.findMany({ where: { surface: SURFACE } });
      assert.equal(rows.length, 1, `round ${round} produced ${rows.length} rows`);
      assert.equal(rows[0]!.observedCount, 2 * OBSERVATIONS_PER_SWEEP, `round ${round} lost an increment`);
    }
  });
});
