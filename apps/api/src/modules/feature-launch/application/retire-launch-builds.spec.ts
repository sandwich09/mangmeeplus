/**
 * REAL-DATABASE spec for the post-deploy retirement pass and the no-op replay race (UAT r5 items 1,
 * 2 and 6).
 *
 * Real database, not a mock, for the same reason the command's race spec is: an in-memory map has no
 * advisory locks and no unique indexes, a fake `$transaction` cannot roll back, and both bugs under
 * test are interleavings — a retirement landing between a command's read and its decision, and two
 * writers appending to one route's `seq`.
 *
 * SKIPS (never fails) when no database is reachable, so the suite still exits 0 without one.
 *
 * ISOLATION is the production property itself: every marker is scoped to a `targetEnvironment`, so a
 * uat pass can never retire a production build. These tests run under a SYNTHETIC environment, which
 * makes every pre-existing local row invisible to the pass — surveyed as "no live build", never
 * touched — while the rows this file writes are fully visible to it. It drives two real matrix
 * routes, records their exact state up front and restores it afterwards.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { resolveDeploymentIdentity } from '@watchdog-bms/config';
import { PrismaClient } from '../../../generated/prisma/client';
import { findLaunchMatrixRow } from '../domain/launch-matrix.catalog';
import { LaunchRetirementHalt, retireLaunchBuilds } from './retire-launch-builds';
import {
  LAUNCH_GATE_ADMIN_ROLE,
  LAUNCH_GATE_MANAGE_PERMISSION,
  LaunchGateCommandUseCase,
} from './use-cases/launch-gate-command.use-case';

const TAG = `r5-retire-${process.pid}`;
/** A synthetic environment nothing else has ever written to — see ISOLATION above. */
const ENVIRONMENT = `retire-spec-${process.pid}`;
/**
 * Two real ORDINARY matrix routes: one SYSTEM-opened, one human-opened (item 6). They must be routes
 * NO other real-database spec drives — node:test runs spec FILES in parallel, and a gate row has one
 * `generation` column, so two files on one route fight over it. `inventory/DEFAULT` belongs to
 * `launch-gate-command.use-case.race.spec.ts`.
 */
const SYSTEM_ROUTE = findLaunchMatrixRow('reports', 'DEFAULT')!;
const HUMAN_ROUTE = findLaunchMatrixRow('product_catalog', 'DEFAULT')!;
const DEPLOYMENT = resolveDeploymentIdentity(process.env);
/** Far past anything a local bootstrap wrote, so no real generation is ever in play. */
const GENERATION = 9_500 + (process.pid % 500);
const ACTIVE = `active-build-${process.pid}`;
const DRAINED = `drained-build-${process.pid}`;
const DEPLOYMENT_ARN = `arn:aws:ecs:ap-southeast-1:311414082667:service-deployment/${ENVIRONMENT}/api-web/deployment`;

it('HALTS when no OPEN gate rows exist instead of reporting a false successful retirement', async () => {
  const prisma = { client: { featureLaunchGate: { findMany: async () => [] } } } as any;
  await assert.rejects(
    () => retireLaunchBuilds(prisma, {
      activeBuilds: [ACTIVE],
      deployment: { targetEnvironment: ENVIRONMENT as any, buildReleaseId: ACTIVE },
      deploymentArn: DEPLOYMENT_ARN,
      requestId: `${TAG}-empty-catalog`,
    }),
    (error: LaunchRetirementHalt) => {
      assert.match(error.message, /no OPEN launch-gate rows exist/);
      return true;
    },
  );
});

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

describe('retireLaunchBuilds (real database)', () => {
  let clients: PrismaClient[] = [];
  let reachable = false;
  let actorUserId = '';
  /** Every route this file touches, as it was before the first test. */
  const baselines = new Map<string, { state: string; generation: number; lastSeq: number; reason: string | null } | null>();

  const routes = [SYSTEM_ROUTE, HUMAN_ROUTE];
  const label = (route: typeof SYSTEM_ROUTE) => `${route.gateKey} ${route.routeKey}`;
  const whereOf = (route: typeof SYSTEM_ROUTE) => ({
    gateKey_routeKey: { gateKey: route.gateKey, routeKey: route.routeKey },
  });
  const service = () => ({ client: clients[0]! }) as any;

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
    const user = await clients[0]!.user.findFirst({ select: { id: true }, orderBy: { id: 'asc' } });
    if (!user) {
      reachable = false;
      return;
    }
    actorUserId = user.id;
    for (const route of routes) {
      baselines.set(label(route), await clients[0]!.featureLaunchGate.findUnique({
        where: whereOf(route),
        select: { state: true, generation: true, lastSeq: true, reason: true },
      }));
    }
  });

  after(async () => {
    if (clients.length === 0) return;
    if (reachable) {
      // Only rows this file wrote carry the synthetic environment or the tagged requestId.
      await clients[0]!.featureLaunchGateTransition.deleteMany({ where: { targetEnvironment: ENVIRONMENT } });
      await clients[0]!.featureLaunchCommandResult.deleteMany({ where: { commandId: { startsWith: TAG } } });
      await clients[0]!.featureLaunchGateTransition.deleteMany({ where: { commandId: { startsWith: TAG } } });
      await clients[0]!.auditLog.deleteMany({ where: { requestId: { startsWith: TAG } } });
      for (const route of routes) {
        const baseline = baselines.get(label(route));
        if (baseline) await clients[0]!.featureLaunchGate.update({ where: whereOf(route), data: baseline as any });
        else await clients[0]!.featureLaunchGate.deleteMany({ where: { gateKey: route.gateKey, routeKey: route.routeKey } });
      }
    }
    await Promise.all(clients.map((client) => client.$disconnect()));
  });

  /** Puts one route on a synthetic OPEN generation carrying exactly the given attested builds. */
  async function seedRoute(
    route: typeof SYSTEM_ROUTE,
    lineageActor: string,
    builds: readonly string[],
    generation = GENERATION,
  ): Promise<void> {
    await clients[0]!.featureLaunchGateTransition.deleteMany({
      where: { gateKey: route.gateKey, routeKey: route.routeKey, targetEnvironment: ENVIRONMENT },
    });
    // `seq` is unique per ROUTE, not per generation, so the synthetic rows have to sit above every
    // sequence the real local bootstrap already wrote on this route.
    const highest = await clients[0]!.featureLaunchGateTransition.findFirst({
      where: { gateKey: route.gateKey, routeKey: route.routeKey },
      select: { seq: true },
      orderBy: { seq: 'desc' },
    });
    const base = (highest?.seq ?? 0) + 1;
    await clients[0]!.featureLaunchGate.upsert({
      where: whereOf(route),
      create: { gateKey: route.gateKey, routeKey: route.routeKey, state: 'OPEN', generation, lastSeq: base + builds.length - 1, reason: TAG },
      update: { state: 'OPEN', generation, lastSeq: base + builds.length - 1, reason: TAG },
    });
    let seq = base;
    for (const buildReleaseId of builds) {
      await clients[0]!.featureLaunchGateTransition.create({
        data: {
          gateKey: route.gateKey,
          routeKey: route.routeKey,
          seq,
          generation,
          commandId: `${TAG}:seed:${route.gateKey}:${buildReleaseId}:s${seq}`,
          action: 'OPEN',
          // The lineage of the generation is its FIRST OPEN, so only the first actor decides it.
          actorUserId: seq === base ? lineageActor : 'SYSTEM',
          payloadFingerprint: `${TAG}:seed`,
          targetEnvironment: ENVIRONMENT,
          buildReleaseId,
          expectedGeneration: generation,
          routeClass: 'ORDINARY',
          releaseApprovedByUserId: lineageActor,
        },
      });
      seq += 1;
    }
  }

  const markers = (route: typeof SYSTEM_ROUTE) => clients[0]!.featureLaunchGateTransition.findMany({
    where: { gateKey: route.gateKey, routeKey: route.routeKey, targetEnvironment: ENVIRONMENT },
    select: { action: true, buildReleaseId: true, seq: true, generation: true, reason: true },
    orderBy: { seq: 'asc' },
  });

  const run = (
    activeBuilds: readonly string[],
    options: { mode?: 'retire' | 'reconcile'; requestId?: string } = {},
  ) => retireLaunchBuilds(service(), {
    activeBuilds,
    mode: options.mode,
    deployment: { targetEnvironment: ENVIRONMENT as any, buildReleaseId: ACTIVE },
    requestId: options.requestId ?? `${TAG}-pass`,
    deploymentArn: DEPLOYMENT_ARN,
  });

  it('retires the drained build and leaves the serving one, on a SYSTEM-opened route', async (t) => {
    if (!reachable) return t.skip('no database reachable — start docker postgres on 127.0.0.1:15432');
    await seedRoute(SYSTEM_ROUTE, 'SYSTEM', [DRAINED, ACTIVE]);

    const result = await run([ACTIVE]);

    assert.deepEqual(
      result.retired.map((row) => row.buildReleaseId),
      [DRAINED],
      'exactly the build that stopped serving loses authority',
    );
    const rows = await markers(SYSTEM_ROUTE);
    assert.deepEqual(
      rows.map((row) => [row.action, row.buildReleaseId]),
      [['OPEN', DRAINED], ['OPEN', ACTIVE], ['CLOSE', DRAINED]],
      'append-only: the original approvals are still there, unrewritten',
    );
    assert.ok(rows.every((row) => row.generation === GENERATION), 'a retirement never moves the generation');
    const gate = await clients[0]!.featureLaunchGate.findUniqueOrThrow({ where: whereOf(SYSTEM_ROUTE) });
    assert.equal(gate.lastSeq, rows.at(-1)!.seq, 'lastSeq points at the newest marker');
    assert.equal(gate.state, 'OPEN', 'bounding the window never closes the route');

    // Item 6 — the marker is an audited authority change, not a silent bookkeeping row.
    const audits = await clients[0]!.auditLog.findMany({ where: { requestId: `${TAG}-pass` }, select: { action: true, riskLevel: true } });
    assert.deepEqual(audits, [{ action: 'system.launch_gate.retire_build', riskLevel: 'HIGH' }]);
  });

  /**
   * UAT r6 item 4b — the rollout FAILED and the platform rolled back. The pre-deploy release task had
   * already attested the incoming build, which then never served a single request, so the post-rollback
   * active list is the OLD build alone. Reconcile must take the incoming build's authority away and
   * leave the one actually serving — which the old retirement could not do at all, because it demanded
   * the deployed commit be in the active list, and after a rollback it never is.
   */
  it('RECONCILE retires a pre-attested build that never served, keeping the rolled-back-to build', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    const INCOMING = `incoming-build-${process.pid}`;
    // ACTIVE is the build serving before and after the failed rollout; INCOMING is the release task's
    // pre-attestation of the deploy that never converged.
    await seedRoute(SYSTEM_ROUTE, 'SYSTEM', [ACTIVE, INCOMING]);

    const result = await run([ACTIVE], { mode: 'reconcile', requestId: `${TAG}-reconcile` });

    assert.deepEqual(
      result.retired.map((row) => row.buildReleaseId),
      [INCOMING],
      'the build that never became active loses authority; the serving one keeps it',
    );
    const rows = await markers(SYSTEM_ROUTE);
    assert.deepEqual(
      rows.map((row) => [row.action, row.buildReleaseId]),
      [['OPEN', ACTIVE], ['OPEN', INCOMING], ['CLOSE', INCOMING]],
      'append-only, and the rolled-back-to build is never closed',
    );
    assert.match(rows.at(-1)!.reason!, /post-rollback reconciliation/, 'the ledger says which moment retired it');
    const audits = await clients[0]!.auditLog.findMany({
      where: { requestId: `${TAG}-reconcile` },
      select: { action: true, metadataJson: true },
    });
    assert.equal(audits.length, 1);
    assert.equal((audits[0]!.metadataJson as { mode?: string }).mode, 'reconcile');
  });

  /** Reconcile relaxes nothing: an unattested active build still halts the whole pass. */
  it('RECONCILE still HALTS when an active build is unattested', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    await seedRoute(SYSTEM_ROUTE, 'SYSTEM', [DRAINED]);

    await assert.rejects(
      () => run([ACTIVE], { mode: 'reconcile', requestId: `${TAG}-reconcile-halt` }),
      (err: LaunchRetirementHalt) => {
        assert.match(err.message, new RegExp(`active build ${ACTIVE} is NOT attested`));
        return true;
      },
    );
    assert.deepEqual((await markers(SYSTEM_ROUTE)).map((row) => row.action), ['OPEN']);
  });

  /**
   * UAT r7 item 1(c) — `retire` means "these are the builds serving after health verification, and
   * the one I just deployed is among them". An active list that does NOT name the incoming build is
   * a rollback wearing a retirement label: acting on it would close every build except the one that
   * never served. The shell refuses the same shape (run-release-task.sh), but the authority to
   * retire is this pass, so the rule is enforced here — and `reconcile`, on identical inputs, is
   * exactly the mode that IS allowed to answer it.
   */
  it('HALTS a retire whose active list omits the incoming build, and reconcile accepts the same inputs', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    await seedRoute(SYSTEM_ROUTE, 'SYSTEM', [DRAINED, ACTIVE]);

    // `run` deploys ACTIVE; the platform says only DRAINED is serving — a rollback, not a rollout.
    await assert.rejects(
      () => run([DRAINED], { requestId: `${TAG}-retire-not-serving` }),
      (err: LaunchRetirementHalt) => {
        assert.ok(err instanceof LaunchRetirementHalt);
        assert.match(err.message, new RegExp(`retire requires the incoming build ${ACTIVE} to be serving`));
        return true;
      },
    );
    assert.deepEqual(
      (await markers(SYSTEM_ROUTE)).map((row) => row.action),
      ['OPEN', 'OPEN'],
      'a halted retire writes nothing at all',
    );
    assert.equal(
      await clients[0]!.auditLog.count({ where: { requestId: `${TAG}-retire-not-serving` } }),
      0,
    );

    const reconciled = await run([DRAINED], { mode: 'reconcile', requestId: `${TAG}-retire-not-serving-ok` });

    assert.deepEqual(
      reconciled.retired.map((row) => row.buildReleaseId),
      [ACTIVE],
      'reconcile is exempt: the pre-attested build that never served loses authority',
    );
  });

  it('is idempotent — a second pass retires nothing and appends nothing', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    await seedRoute(SYSTEM_ROUTE, 'SYSTEM', [DRAINED, ACTIVE]);
    await run([ACTIVE]);
    const before = await markers(SYSTEM_ROUTE);

    const second = await run([ACTIVE]);

    assert.equal(second.retired.length, 0, 'an already-retired build is never retired twice');
    assert.deepEqual(await markers(SYSTEM_ROUTE), before);
  });

  /** Item 6 — a human approval is bounded by exactly the same rule; there is no exemption. */
  it('retires a HUMAN-approved build that is no longer serving', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    await seedRoute(SYSTEM_ROUTE, 'SYSTEM', [ACTIVE]);
    await seedRoute(HUMAN_ROUTE, actorUserId, [DRAINED]);

    const result = await run([ACTIVE]);

    assert.deepEqual(
      result.retired.map((row) => [row.gateKey, row.buildReleaseId]),
      [[HUMAN_ROUTE.gateKey, DRAINED]],
      'a human approval bounded exactly like a system attestation',
    );
    const rows = await markers(HUMAN_ROUTE);
    assert.deepEqual(rows.map((row) => row.action), ['OPEN', 'CLOSE'], 'the human OPEN is preserved, never rewritten');
  });

  /**
   * The "never guess" rule. An active build the release task never attested means the list did not
   * come from this deployment — so the pass refuses ENTIRELY rather than retiring against it.
   */
  it('HALTS, retiring nothing, when an active build is unattested on a SYSTEM route', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    await seedRoute(SYSTEM_ROUTE, 'SYSTEM', [DRAINED]);
    await seedRoute(HUMAN_ROUTE, actorUserId, [DRAINED]);

    await assert.rejects(
      () => run([ACTIVE]),
      (err: LaunchRetirementHalt) => {
        assert.ok(err instanceof LaunchRetirementHalt);
        assert.match(err.message, new RegExp(`active build ${ACTIVE} is NOT attested`));
        return true;
      },
    );
    for (const route of routes) {
      assert.deepEqual((await markers(route)).map((row) => row.action), ['OPEN'], `${route.gateKey}: nothing was retired`);
    }
  });

  it('HALTS on an empty active list rather than retiring every attested build', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    await seedRoute(SYSTEM_ROUTE, 'SYSTEM', [DRAINED, ACTIVE]);

    await assert.rejects(() => run([]), (err: LaunchRetirementHalt) => {
      assert.match(err.message, /--active-builds is empty/);
      return true;
    });
    assert.deepEqual((await markers(SYSTEM_ROUTE)).map((row) => row.action), ['OPEN', 'OPEN']);
  });

  it('HALTS when more builds are serving than the window allows', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    await seedRoute(SYSTEM_ROUTE, 'SYSTEM', [DRAINED, ACTIVE, `third-${process.pid}`]);

    await assert.rejects(() => run([DRAINED, ACTIVE, `third-${process.pid}`]), (err: LaunchRetirementHalt) => {
      assert.match(err.message, /3 builds are serving at once/);
      return true;
    });
    assert.equal((await markers(SYSTEM_ROUTE)).filter((row) => row.action === 'CLOSE').length, 0);
  });

  /** With only human-opened routes live, nothing corroborates the active list, so it is unverified. */
  it('HALTS when no SYSTEM-opened route corroborates the active list', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    await clients[0]!.featureLaunchGateTransition.deleteMany({
      where: { gateKey: SYSTEM_ROUTE.gateKey, routeKey: SYSTEM_ROUTE.routeKey, targetEnvironment: ENVIRONMENT },
    });
    await seedRoute(HUMAN_ROUTE, actorUserId, [DRAINED, ACTIVE]);

    await assert.rejects(() => run([ACTIVE]), (err: LaunchRetirementHalt) => {
      assert.match(err.message, /no SYSTEM-opened route corroborates/);
      return true;
    });
    assert.equal((await markers(HUMAN_ROUTE)).filter((row) => row.action === 'CLOSE').length, 0);
  });

  /** A CLOSE between survey and lock kills the whole generation; the stale plan must not write to it. */
  it('skips a route whose generation moved between the survey and the lock', async (t) => {
    if (!reachable) return t.skip('no database reachable');
    await seedRoute(SYSTEM_ROUTE, 'SYSTEM', [DRAINED, ACTIVE]);
    await seedRoute(HUMAN_ROUTE, actorUserId, [DRAINED], GENERATION);
    // The operator closes and reopens the human route while the pass is between its two phases.
    const pass = retireLaunchBuilds(service(), {
      activeBuilds: [ACTIVE],
      deployment: { targetEnvironment: ENVIRONMENT as any, buildReleaseId: ACTIVE },
      requestId: `${TAG}-pass`,
      deploymentArn: DEPLOYMENT_ARN,
    });
    await clients[1]!.featureLaunchGate.update({ where: whereOf(HUMAN_ROUTE), data: { generation: GENERATION + 1 } });
    const result = await pass;

    assert.ok(
      !result.retired.some((row) => row.gateKey === HUMAN_ROUTE.gateKey)
      || result.skipped.some((row) => row.gateKey === HUMAN_ROUTE.gateKey),
      'a moved generation is either skipped or was retired before it moved — never written to afterwards',
    );
    const stale = (await markers(HUMAN_ROUTE)).filter((row) => row.generation !== GENERATION);
    assert.equal(stale.length, 0, 'nothing was appended at the new generation');
  });
});

/**
 * UAT r5 item 2 — the no-op replay race, on the real database.
 *
 * A no-op OPEN stored nothing, so its idempotence was only as durable as the world it was decided
 * against. Retire the build it named and the SAME commandId stops looking satisfied: the acceptance
 * branch appends a fresh OPEN and re-admits a build nobody re-approved. Driven concurrently, in both
 * orders, because "the retirement lands first" and "the replay lands first" are different code paths.
 */
describe('no-op command replay vs retirement (real database)', () => {
  let clients: PrismaClient[] = [];
  let reachable = false;
  let actorUserId = '';
  let baseline: { state: string; generation: number; lastSeq: number; reason: string | null } | null = null;

  const ROUTE = findLaunchMatrixRow('workflow_automation', 'DEFAULT')!;
  const where = { gateKey_routeKey: { gateKey: ROUTE.gateKey, routeKey: ROUTE.routeKey } };
  const RACES = 15;

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
    const user = await clients[0]!.user.findFirst({ select: { id: true }, orderBy: { id: 'asc' } });
    if (!user) {
      reachable = false;
      return;
    }
    actorUserId = user.id;
    baseline = await clients[0]!.featureLaunchGate.findUnique({
      where,
      select: { state: true, generation: true, lastSeq: true, reason: true },
    });
  });

  after(async () => {
    if (clients.length === 0) return;
    if (reachable) {
      await clients[0]!.featureLaunchGateTransition.deleteMany({
        where: { gateKey: ROUTE.gateKey, routeKey: ROUTE.routeKey, seq: { gt: baseline?.lastSeq ?? 0 } },
      });
      await clients[0]!.featureLaunchCommandResult.deleteMany({ where: { commandId: { startsWith: TAG } } });
      await clients[0]!.auditLog.deleteMany({ where: { requestId: { startsWith: TAG } } });
      if (baseline) await clients[0]!.featureLaunchGate.update({ where, data: baseline as any });
      else await clients[0]!.featureLaunchGate.deleteMany({ where: { gateKey: ROUTE.gateKey, routeKey: ROUTE.routeKey } });
    }
    await Promise.all(clients.map((client) => client.$disconnect()));
  });

  /** An OPEN generation this deployment already holds authority on — so the command below is a no-op. */
  async function seedGeneration(round: number): Promise<{ generation: number; lastSeq: number }> {
    const generation = GENERATION + 100 + round;
    const lastSeq = (baseline?.lastSeq ?? 0) + 1 + round * 10;
    await clients[0]!.featureLaunchGateTransition.deleteMany({
      where: { gateKey: ROUTE.gateKey, routeKey: ROUTE.routeKey, seq: { gt: baseline?.lastSeq ?? 0 } },
    });
    await clients[0]!.featureLaunchGate.update({ where, data: { state: 'OPEN', generation, lastSeq, reason: TAG } });
    await clients[0]!.featureLaunchGateTransition.create({
      data: {
        gateKey: ROUTE.gateKey,
        routeKey: ROUTE.routeKey,
        seq: lastSeq,
        generation,
        commandId: `${TAG}:noop-baseline:${round}`,
        action: 'OPEN',
        actorUserId: 'SYSTEM',
        payloadFingerprint: `${TAG}:noop-baseline:${round}`,
        targetEnvironment: DEPLOYMENT.targetEnvironment,
        buildReleaseId: DEPLOYMENT.buildReleaseId,
        expectedGeneration: generation,
        routeClass: 'ORDINARY',
        releaseApprovedByUserId: 'SYSTEM',
      },
    });
    return { generation, lastSeq };
  }

  it('never re-attests a retired build, whichever of the replay and the retirement lands first', async (t) => {
    if (!reachable) return t.skip('no database reachable — start docker postgres on 127.0.0.1:15432');

    let replayFirst = 0;
    for (let round = 0; round < RACES; round++) {
      const { generation, lastSeq } = await seedGeneration(round);
      const command = {
        gateKey: ROUTE.gateKey,
        routeKey: ROUTE.routeKey,
        action: 'OPEN' as const,
        commandId: `${TAG}:noop:${round}`,
        actorUserId,
        actorRoles: [LAUNCH_GATE_ADMIN_ROLE],
        actorPermissions: [LAUNCH_GATE_MANAGE_PERMISSION],
        requestId: `${TAG}-noop-${round}`,
        snapshot: { expectedGeneration: generation, emergencyClose: false },
      };

      // The original command: this deployment already holds authority, so nothing happens — and,
      // since item 2, that "nothing" is STORED.
      const first = await new LaunchGateCommandUseCase({ client: clients[0]! } as any).execute(command);
      assert.equal(first.changed, false, `round ${round}: the setup command was not a no-op`);
      assert.equal(first.replayed, false, `round ${round}`);

      // The delayed retry races the retirement of the very build it named.
      const [replay] = await Promise.all([
        new LaunchGateCommandUseCase({ client: clients[0]! } as any).execute(command),
        clients[1]!.featureLaunchGateTransition.create({
          data: {
            gateKey: ROUTE.gateKey,
            routeKey: ROUTE.routeKey,
            seq: lastSeq + 1,
            generation,
            commandId: `F1-RETIRE:${DEPLOYMENT.targetEnvironment}:${DEPLOYMENT.buildReleaseId}:g${generation}:s${lastSeq + 1}`,
            action: 'CLOSE',
            actorUserId: 'SYSTEM',
            payloadFingerprint: `${TAG}:retire:${round}`,
            targetEnvironment: DEPLOYMENT.targetEnvironment,
            buildReleaseId: DEPLOYMENT.buildReleaseId,
            expectedGeneration: generation,
            routeClass: 'ORDINARY',
            releaseApprovedByUserId: 'SYSTEM',
          },
        }),
      ]);

      assert.deepEqual(
        { changed: replay.changed, replayed: replay.replayed, generation: replay.generation },
        { changed: false, replayed: true, generation },
        `round ${round}: the retry was answered from live state instead of the stored result`,
      );
      const appended = await clients[0]!.featureLaunchGateTransition.findMany({
        where: { gateKey: ROUTE.gateKey, routeKey: ROUTE.routeKey, seq: { gt: lastSeq } },
        select: { action: true },
      });
      assert.deepEqual(
        appended.map((row) => row.action),
        ['CLOSE'],
        `round ${round}: the retired build was RE-ATTESTED by replaying a no-op`,
      );
      const results = await clients[0]!.featureLaunchCommandResult.findMany({
        where: { gateKey: ROUTE.gateKey, routeKey: ROUTE.routeKey, commandId: command.commandId },
        select: { resultKind: true },
      });
      assert.deepEqual(results, [{ resultKind: 'NOOP' }], `round ${round}: exactly one stored result per commandId`);
      if (replay.lastSeq === lastSeq) replayFirst += 1;
    }
    assert.equal(replayFirst, RACES, 'a replay must always answer the ORIGINAL seq, never the retirement’s');
  });
});
