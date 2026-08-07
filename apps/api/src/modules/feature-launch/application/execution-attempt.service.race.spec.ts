/**
 * REAL-DATABASE spec for `ExecutionAttempt` identity/sequence uniqueness and expired-lease fencing
 * (F1.5.1 items 2 + 5).
 *
 * Every invariant here is invisible to a mocked test: a shared in-memory row cannot lose a race, and
 * a fake `$transaction` cannot take `FOR UPDATE`. `execution-attempt.service.spec.ts` pins the guard
 * LOGIC against a double; this pins the CONCURRENCY behaviour against two real connections.
 *
 * SKIPS (never fails) when no database is reachable, so the suite still exits 0 without one.
 *
 * Safety: every row it writes is tagged with `sourceType = TAG` and deleted afterwards. It creates
 * no companies — it borrows two ids that already exist and never writes to them.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ConflictException } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { resolveDeploymentIdentity } from '@watchdog-bms/config';
import { PrismaClient } from '../../../generated/prisma/client';
import { ExecutionAttemptService, scopedAttemptKey } from './execution-attempt.service';

const TAG = `f151-attempt-${process.pid}`;
/** Its own gate namespace, so the launch-gate rows this file writes collide with nothing. */
const GATE_KEY = `f152-gate-${process.pid}`;
const DEPLOYMENT = resolveDeploymentIdentity(process.env);
/** The build a rolling deploy is replacing — never this process's own. */
const PREVIOUS_BUILD = `previous-build-${process.pid}`;
/**
 * Independent rows per race, so one lucky iteration cannot hide a defect. Sized against the measured
 * pre-fix failure rates: ~92% of expired-lease takeovers double-granted, and ~21% of concurrent
 * identical stamps raised a non-arbiter unique violation, so 25 rounds leaves neither to chance.
 */
const RACES = 25;

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

const noopLogger = { warn() {}, info() {}, error() {} } as any;

describe('ExecutionAttempt identity + lease fencing (real database)', () => {
  let clients: PrismaClient[] = [];
  let services: ExecutionAttemptService[] = [];
  let companies: string[] = [];
  let reachable = false;

  const stamp = (index: number, overrides: Record<string, unknown> = {}) => ({
    // No features and no routes: the availability vector is empty, so the guard is trivially
    // satisfied and every assertion here is about identity and the lease, nothing else.
    companyId: null as string | null,
    sourceType: TAG,
    sourceId: `src-${index}`,
    attemptKey: `${TAG}:key-${index}`,
    featureKeys: [] as string[],
    routes: [] as { gateKey: string }[],
    ...overrides,
  });

  /** A fresh attempt already holding an EXPIRED dispatch lease owned by `worker-dead`. */
  async function attemptWithExpiredLease(index: number): Promise<string> {
    const attempt = await services[0]!.createStampedAttempt(stamp(index));
    assert.equal((await services[0]!.claimAttempt(attempt.id)).claimed, true);
    assert.ok(await services[0]!.acquireDispatchLease(attempt.id, 'worker-dead'));
    await clients[0]!.executionAttempt.update({
      where: { id: attempt.id },
      data: { leaseExpiresAt: new Date(Date.now() - 60_000) },
    });
    return attempt.id;
  }

  before(async () => {
    const url = rootDatabaseUrl();
    if (!url) return;
    try {
      clients = [
        new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) }),
        new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) }),
      ];
      await clients[0]!.$queryRaw`SELECT 1`;
      reachable = true;
    } catch {
      reachable = false;
      return;
    }
    services = clients.map((client) =>
      new ExecutionAttemptService({ client } as any, noopLogger, { deploymentIdentity: DEPLOYMENT } as any));
    companies = (await clients[0]!.company.findMany({ take: 2, select: { id: true }, orderBy: { id: 'asc' } }))
      .map((row) => row.id);
  });

  after(async () => {
    if (!reachable) return;
    await clients[0]!.executionAttempt.deleteMany({ where: { sourceType: TAG } });
    await clients[0]!.featureLaunchGateTransition.deleteMany({ where: { gateKey: GATE_KEY } });
    await clients[0]!.featureLaunchGate.deleteMany({ where: { gateKey: GATE_KEY } });
    await Promise.all(clients.map((client) => client.$disconnect()));
  });

  /**
   * One OPEN route at `generation`, attested on exactly `builds` — the shape a rolling deploy leaves
   * behind, where the outgoing and incoming builds both hold an attestation inside ONE generation.
   */
  async function seedAttestedGate(generation: number, builds: readonly string[]): Promise<void> {
    await clients[0]!.featureLaunchGateTransition.deleteMany({ where: { gateKey: GATE_KEY } });
    await clients[0]!.featureLaunchGate.upsert({
      where: { gateKey_routeKey: { gateKey: GATE_KEY, routeKey: 'DEFAULT' } },
      create: { gateKey: GATE_KEY, routeKey: 'DEFAULT', state: 'OPEN', generation, lastSeq: builds.length },
      update: { state: 'OPEN', generation, lastSeq: builds.length },
    });
    for (const [index, buildReleaseId] of builds.entries()) {
      await clients[0]!.featureLaunchGateTransition.create({
        data: {
          gateKey: GATE_KEY,
          routeKey: 'DEFAULT',
          seq: index + 1,
          generation,
          commandId: `${GATE_KEY}:${buildReleaseId}`,
          action: 'OPEN',
          actorUserId: 'SYSTEM',
          payloadFingerprint: `${GATE_KEY}:${buildReleaseId}`,
          targetEnvironment: DEPLOYMENT.targetEnvironment,
          buildReleaseId,
          expectedGeneration: generation,
          routeClass: 'ORDINARY',
        },
      });
    }
  }

  /** A QUEUED attempt on the gated route, rewritten to look like it was stamped on `buildReleaseId`. */
  async function attemptStampedOnBuild(label: string, buildReleaseId: string): Promise<string> {
    const attempt = await services[0]!.createStampedAttempt(stamp(0, {
      sourceId: label,
      attemptKey: `${TAG}:${label}`,
      routes: [{ gateKey: GATE_KEY }],
    }));
    await clients[0]!.executionAttempt.update({ where: { id: attempt.id }, data: { buildReleaseId } });
    return attempt.id;
  }

  /** (a) The bug the owner review named: two workers both see an expired lease and both take it. */
  it('gives an EXPIRED lease to exactly one of two racing workers', async (t) => {
    if (!reachable) return t.skip('no database reachable — start docker postgres on 127.0.0.1:15432');

    let winners = 0;
    for (let index = 0; index < RACES; index++) {
      const attemptId = await attemptWithExpiredLease(index);
      const granted = await Promise.all([
        services[0]!.acquireDispatchLease(attemptId, 'worker-a'),
        services[1]!.acquireDispatchLease(attemptId, 'worker-b'),
      ]);

      const held = granted.filter((lease) => lease !== null);
      assert.equal(held.length, 1, `both workers took the same lease on race ${index}`);
      winners++;

      const row = await clients[0]!.executionAttempt.findUniqueOrThrow({ where: { id: attemptId } });
      assert.equal(row.leaseOwner, held[0]!.leaseOwner, 'the row is held by the winner');
      assert.equal(row.leaseGeneration, held[0]!.leaseGeneration);
      // The token is the provider idempotency key: a resumed pre-dispatch lease reuses it.
      assert.equal(row.dispatchToken, held[0]!.dispatchToken);
      assert.equal(row.leaseGeneration, 2, 'one takeover past the dead holder, not two');
    }
    assert.equal(winners, RACES);
  });

  /** (b) One row per (company, source, seq), and the loser gets that row rather than an error. */
  it('collapses two writers racing the same (company, source, seq) onto one attempt', async (t) => {
    if (!reachable) return t.skip('no database reachable');

    for (let index = 0; index < RACES; index++) {
      const input = stamp(index, {
        companyId: companies[0] ?? null,
        sourceId: `dup-${index}`,
        attemptKey: `${TAG}:dup-${index}`,
      });
      const stamped = await Promise.all(services.map((service) => service.createStampedAttempt(input)));
      assert.equal(stamped[0]!.id, stamped[1]!.id, `race ${index} produced two different attempts`);
    }
    const rows = await clients[0]!.executionAttempt.count({
      where: { sourceType: TAG, sourceId: { startsWith: 'dup-' } },
    });
    assert.equal(rows, RACES, 'exactly one row per raced source id');
  });

  /** (c) The GLOBAL `(sourceType, sourceId, attemptSeq)` unique this migration replaced. */
  it('keeps two companies sharing one source id independent', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    if (companies.length < 2) return t.skip('needs two existing companies');

    const shared = { sourceId: 'shared-source', attemptKey: `${TAG}:shared` };
    const first = await services[0]!.createStampedAttempt(stamp(0, { ...shared, companyId: companies[0] }));
    const second = await services[1]!.createStampedAttempt(stamp(0, { ...shared, companyId: companies[1] }));

    assert.notEqual(first.id, second.id, 'one company resumed work belonging to the other');
    const rows = await clients[0]!.executionAttempt.findMany({
      where: { sourceType: TAG, sourceId: 'shared-source' },
      select: { companyId: true, companyScope: true, attemptKey: true },
      orderBy: { companyScope: 'asc' },
    });
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((row) => row.companyScope), [...companies].sort());
    assert.deepEqual(
      rows.map((row) => row.attemptKey).sort(),
      [...companies].sort().map((id) => scopedAttemptKey(id, `${TAG}:shared`)),
    );
    // Platform-level work is a third, independent scope — the sentinel is not a shared bucket.
    const platform = await services[0]!.createStampedAttempt(stamp(0, { ...shared, companyId: null }));
    assert.ok(![first.id, second.id].includes(platform.id));
  });

  /** (d) Resume/Reissue mints the next sequence; it never revives the row it replaces. */
  it('mints a NEW attempt at seq 2 and leaves seq 1 untouched', async (t) => {
    if (!reachable) return t.skip('no database reachable');

    const input = stamp(0, { sourceId: 'resume-source', attemptKey: `${TAG}:resume` });
    const first = await services[0]!.createStampedAttempt(input);
    assert.equal((await services[0]!.claimAttempt(first.id)).claimed, true);

    const resumed = await services[1]!.createStampedAttempt({ ...input, attemptSeq: 2 });
    assert.notEqual(resumed.id, first.id, 'seq 2 resumed attempt #1 instead of minting a new one');
    assert.equal(resumed.status, 'QUEUED');

    const rows = await clients[0]!.executionAttempt.findMany({
      where: { sourceType: TAG, sourceId: 'resume-source' },
      select: { id: true, attemptSeq: true, status: true, attemptKey: true },
      orderBy: { attemptSeq: 'asc' },
    });
    assert.deepEqual(rows.map((row) => row.attemptSeq), [1, 2]);
    assert.equal(rows[0]!.status, 'CLAIMED', 'attempt #1 was mutated by the resume');
    assert.deepEqual(
      rows.map((row) => row.attemptKey),
      [scopedAttemptKey(null, `${TAG}:resume`, 1), scopedAttemptKey(null, `${TAG}:resume`, 2)],
    );
    // Re-stamping seq 2 is idempotent, not a third row.
    assert.equal((await services[0]!.createStampedAttempt({ ...input, attemptSeq: 2 })).id, resumed.id);
  });

  /** (e) The zombie: the dead holder wakes up after takeover and tries to finish. */
  it('no-ops every completion path from a worker whose lease was taken over', async (t) => {
    if (!reachable) return t.skip('no database reachable');

    const attempt = await services[0]!.createStampedAttempt(stamp(0, { sourceId: 'zombie', attemptKey: `${TAG}:zombie` }));
    assert.equal((await services[0]!.claimAttempt(attempt.id)).claimed, true);
    const stale = (await services[0]!.acquireDispatchLease(attempt.id, 'worker-dead'))!;
    assert.ok(stale);

    await clients[0]!.executionAttempt.update({
      where: { id: attempt.id },
      data: { leaseExpiresAt: new Date(Date.now() - 60_000) },
    });
    const fresh = (await services[1]!.acquireDispatchLease(attempt.id, 'worker-fresh'))!;
    assert.ok(fresh);
    assert.equal(fresh.dispatchToken, stale.dispatchToken, 'the provider idempotency key is reused');
    assert.notEqual(fresh.leaseGeneration, stale.leaseGeneration);

    // Same owner NAME but a stranded generation is still stale — a restarted worker is not the holder.
    for (const zombie of [stale, { ...stale, leaseOwner: 'worker-fresh' }]) {
      assert.equal(await services[0]!.markDispatchStarted(attempt.id, zombie), false);
      assert.equal(await services[0]!.markSucceeded(attempt.id, zombie), false);
      assert.equal(await services[0]!.markUnknownExternalOutcome(attempt.id, 'zombie', zombie), false);
      assert.equal(await services[0]!.renewDispatchLease(attempt.id, zombie), false);
    }
    const held = await clients[0]!.executionAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
    assert.equal(held.status, 'DISPATCHING', 'a zombie overwrote the new holder');
    assert.equal(held.leaseOwner, 'worker-fresh');
    assert.equal(held.dispatchedAt, null);

    // The rightful holder dispatches and completes exactly once; its fence is spent afterwards.
    assert.equal(await services[1]!.markDispatchStarted(attempt.id, fresh, 'provider-ref-1'), true);
    assert.equal(await services[1]!.markSucceeded(attempt.id, fresh), true);
    assert.equal(await services[1]!.markSucceeded(attempt.id, fresh), false);
    const done = await clients[0]!.executionAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
    assert.equal(done.status, 'SUCCEEDED');
    assert.equal(done.leaseOwner, null);
    // And the terminal row is not revivable by the zombie either.
    assert.equal(await services[0]!.markUnknownExternalOutcome(attempt.id, 'zombie', stale), false);
    assert.equal(done.providerRequestRef, 'provider-ref-1');
  });

  /**
   * (f) F1.5.2 ruling 3 — two DIFFERENT caller keys naming ONE (scope, source, seq). The upsert
   * arbitrates on `attemptKey`, so the loser's insert reaches the source unique instead and, before
   * the source advisory lock + in-lock pre-read, surfaced as a bare P2002 no caller could act on:
   * measured at 25 of 25 races on this database, i.e. never idempotent and never answerable.
   */
  it('answers exactly one structured conflict when two keys race one source identity', async (t) => {
    if (!reachable) return t.skip('no database reachable');

    for (let index = 0; index < RACES; index++) {
      const work = { sourceId: `crosskey-${index}` };
      const raced = await Promise.allSettled([
        services[0]!.createStampedAttempt(stamp(index, { ...work, attemptKey: `${TAG}:ck-a-${index}` })),
        services[1]!.createStampedAttempt(stamp(index, { ...work, attemptKey: `${TAG}:ck-b-${index}` })),
      ]);

      const rejected = raced.filter((outcome) => outcome.status === 'rejected');
      assert.equal(raced.filter((outcome) => outcome.status === 'fulfilled').length, 1, `race ${index}`);
      assert.equal(rejected.length, 1, `race ${index}`);
      const error = (rejected[0] as PromiseRejectedResult).reason;
      assert.ok(error instanceof ConflictException, `race ${index} raised ${error?.constructor?.name}: ${error?.message}`);
      const body = (error as ConflictException).getResponse() as any;
      assert.equal(body.code, 'execution_attempt_identity_conflict');
      assert.match(body.attemptKey, new RegExp(`^${TAG}:ck-[ab]-${index}$`));
      assert.match(body.conflictingAttemptKey, new RegExp(`::${TAG}:ck-[ab]-${index}$`));
      assert.notEqual(body.attemptKey, body.conflictingAttemptKey.split('::').pop());
    }

    const rows = await clients[0]!.executionAttempt.count({
      where: { sourceType: TAG, sourceId: { startsWith: 'crosskey-' } },
    });
    assert.equal(rows, RACES, 'exactly one row per raced source identity');
  });

  /**
   * (g) F1.5.2 ruling 2 — the lease is permission to dispatch, not evidence of one. Only
   * `markDispatchStarted` commits before the network call, so success without it would record an
   * outcome for a request that provably never left the process.
   */
  it('rejects success recorded straight after the lease, with no durable dispatch', async (t) => {
    if (!reachable) return t.skip('no database reachable');

    const attempt = await services[0]!.createStampedAttempt(stamp(0, { sourceId: 'no-dispatch', attemptKey: `${TAG}:no-dispatch` }));
    assert.equal((await services[0]!.claimAttempt(attempt.id)).claimed, true);
    const lease = (await services[0]!.acquireDispatchLease(attempt.id, 'worker-a'))!;

    assert.equal(await services[0]!.markSucceeded(attempt.id, lease), false);
    const held = await clients[0]!.executionAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
    assert.equal(held.status, 'DISPATCHING', 'a success was recorded for work that was never sent');
    assert.equal(held.terminalAt, null);

    // With the dispatch record committed, the same fence completes normally.
    assert.equal(await services[0]!.markDispatchStarted(attempt.id, lease), true);
    assert.equal(await services[0]!.markSucceeded(attempt.id, lease), true);
  });

  /**
   * (h) F1.5.2 ruling 4 — FAILED_CONFIRMED is the terminal that a later Resume/Reissue is allowed to
   * follow, so it is the strictest write: exact fence, dispatched, and a lease still unexpired. A
   * holder who cannot prove the lease has, by definition, an UNKNOWN outcome instead.
   */
  it('writes FAILED_CONFIRMED once under a live fence, and UNKNOWN when the lease has lapsed', async (t) => {
    if (!reachable) return t.skip('no database reachable');

    const input = stamp(0, { sourceId: 'failed-confirmed', attemptKey: `${TAG}:failed-confirmed` });
    const attempt = await services[0]!.createStampedAttempt(input);
    assert.equal((await services[0]!.claimAttempt(attempt.id)).claimed, true);
    const lease = (await services[0]!.acquireDispatchLease(attempt.id, 'worker-a'))!;
    // Not dispatched: a provider that was never called cannot have refused.
    assert.equal(await services[0]!.markFailedConfirmed(attempt.id, lease, 'HTTP 400'), false);
    assert.equal(await services[0]!.markDispatchStarted(attempt.id, lease), true);
    assert.equal(await services[1]!.markFailedConfirmed(attempt.id, { ...lease, leaseGeneration: 0 }, 'HTTP 400'), false);

    assert.equal(await services[0]!.markFailedConfirmed(attempt.id, lease, 'HTTP 400 invalid recipient'), true);
    const failed = await clients[0]!.executionAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
    assert.equal(failed.status, 'FAILED_CONFIRMED');
    assert.equal(failed.lastError, 'HTTP 400 invalid recipient');
    assert.equal(failed.leaseOwner, null, 'the lease is released');
    // Written once, and never downgraded to the ambiguous terminal afterwards.
    assert.equal(await services[0]!.markFailedConfirmed(attempt.id, lease), false);
    assert.equal(await services[0]!.markUnknownExternalOutcome(attempt.id, 'late timeout', lease), false);
    assert.equal(await services[0]!.markSucceeded(attempt.id, lease), false);

    // A definitive failure effected nothing, so Resume/Reissue may mint the next sequence and run.
    const resumed = await services[1]!.createStampedAttempt({ ...input, attemptSeq: 2 });
    assert.notEqual(resumed.id, attempt.id);
    assert.equal((await services[1]!.claimAttempt(resumed.id)).claimed, true);

    // The lapsed-lease holder gets the SAFE half instead: may-have-been-sent, never "definitely not".
    const lapsed = await services[0]!.createStampedAttempt(stamp(0, { sourceId: 'lapsed', attemptKey: `${TAG}:lapsed` }));
    assert.equal((await services[0]!.claimAttempt(lapsed.id)).claimed, true);
    const lapsedLease = (await services[0]!.acquireDispatchLease(lapsed.id, 'worker-a'))!;
    assert.equal(await services[0]!.markDispatchStarted(lapsed.id, lapsedLease), true);
    await clients[0]!.executionAttempt.update({
      where: { id: lapsed.id },
      data: { leaseExpiresAt: new Date(Date.now() - 60_000) },
    });
    assert.equal(await services[0]!.markFailedConfirmed(lapsed.id, lapsedLease, 'HTTP 400'), false);
    assert.equal(await services[0]!.markUnknownExternalOutcome(lapsed.id, 'lease lapsed mid-flight', lapsedLease), true);
    const unknown = await clients[0]!.executionAttempt.findUniqueOrThrow({ where: { id: lapsed.id } });
    assert.equal(unknown.status, 'UNKNOWN_EXTERNAL_OUTCOME');
  });

  /**
   * (i) F1.5.2 blocker 2 (service side) — the stamped vector carries the deployment that read the
   * gate approval, and the claim re-checks it against the running one. Both halves of a rolling
   * deploy must keep working, while a build this generation never attested must not.
   */
  it('claims work stamped on a coexisting build, and suppresses work stamped on an unattested one', async (t) => {
    if (!reachable) return t.skip('no database reachable');

    // Rolling deploy: the outgoing build and this process's build are both attested at generation 3.
    await seedAttestedGate(3, [PREVIOUS_BUILD, DEPLOYMENT.buildReleaseId]);
    const coexisting = await attemptStampedOnBuild('deploy-coexist', PREVIOUS_BUILD);
    assert.deepEqual(await services[0]!.claimAttempt(coexisting), { claimed: true, status: 'CLAIMED' });

    // Same generation, but only this build is attested now: the older build's work is not authorized.
    await seedAttestedGate(3, [DEPLOYMENT.buildReleaseId]);
    const stale = await attemptStampedOnBuild('deploy-stale-build', PREVIOUS_BUILD);
    assert.equal((await services[0]!.claimAttempt(stale)).claimed, false);
    const suppressed = await clients[0]!.executionAttempt.findUniqueOrThrow({ where: { id: stale } });
    assert.equal(suppressed.status, 'SUPPRESSED_LAUNCH_GATE_CLOSED');
    assert.match(suppressed.lastError ?? '', /no OPEN attestation for build/);

    // The stamp itself records the running deployment, and a row stamped elsewhere never claims here.
    const here = await clients[0]!.executionAttempt.findUniqueOrThrow({ where: { id: coexisting } });
    assert.equal(here.targetEnvironment, DEPLOYMENT.targetEnvironment);
    const elsewhere = await attemptStampedOnBuild('deploy-other-env', DEPLOYMENT.buildReleaseId);
    await clients[0]!.executionAttempt.update({ where: { id: elsewhere }, data: { targetEnvironment: 'uat-not-this-one' } });
    assert.equal((await services[0]!.claimAttempt(elsewhere)).claimed, false);
    const wrongEnv = await clients[0]!.executionAttempt.findUniqueOrThrow({ where: { id: elsewhere } });
    assert.equal(wrongEnv.status, 'SUPPRESSED_LAUNCH_GATE_CLOSED');
    assert.match(wrongEnv.lastError ?? '', /stamped in uat-not-this-one/);
  });
});
