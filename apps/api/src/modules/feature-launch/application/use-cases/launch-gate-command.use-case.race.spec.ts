/**
 * REAL-DATABASE spec for the launch-gate command / bootstrap-attestation race (F1.5.2 owner ruling
 * 3).
 *
 * The bug: `execute` read the stored command, the gate row and `lastSeq` — and computed the next
 * `seq` — BEFORE taking the exclusive route lock, while `seedLaunchGates` appends per-build
 * attestations that advance `lastSeq` without moving the generation. Two writers on one route then
 * computed the same `seq` and the loser hit `(gateKey, routeKey, seq)`, surfacing as a raw
 * unique-violation no caller could act on. Invisible to a mocked test: an in-memory map has no
 * advisory locks and no unique indexes, and a fake `$transaction` cannot roll back.
 *
 * The pair it races is the real one: during a rolling deploy the OUTGOING task's release job attests
 * ITS build while an operator issues a command on the same route from the incoming build. Because
 * the two name DIFFERENT builds, neither is idempotent against the other — both must land, in either
 * order, at distinct sequences.
 *
 * SKIPS (never fails) when no database is reachable, so the suite still exits 0 without one.
 *
 * Safety: it drives ONE real matrix route, records that route's exact state up front, and restores
 * it afterwards — appended transitions are deleted, the gate row is written back, and the audit rows
 * it creates carry a tagged `requestId`. It creates no users; it borrows one that already exists.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { resolveDeploymentIdentity } from '@watchdog-bms/config';
import { PrismaClient } from '../../../../generated/prisma/client';
import { findLaunchMatrixRow } from '../../domain/launch-matrix.catalog';
import { attestOpenOnThisBuild } from '../seed-launch-gates';
import {
  LAUNCH_GATE_ADMIN_ROLE,
  LAUNCH_GATE_MANAGE_PERMISSION,
  LaunchGateCommandUseCase,
} from './launch-gate-command.use-case';

const TAG = `f152-gate-cmd-${process.pid}`;
/** A real ORDINARY matrix route — the command validates against the catalog, so it cannot be synthetic. */
const ROUTE = findLaunchMatrixRow('inventory', 'DEFAULT')!;
const DEPLOYMENT = resolveDeploymentIdentity(process.env);
/** The build whose release task is still attesting while the operator commands from the running one. */
const ROLLING_BUILD = `rolling-previous-${process.pid}`;
/** The build that created the generation under test — SYSTEM lineage, so the bootstrap may attest. */
const BASELINE_BUILD = `baseline-${process.pid}`;
/** The generation the whole file works on: far past anything a local bootstrap wrote. */
const GENERATION = 9_000 + (process.pid % 1_000);
const RACES = 25;

/**
 * The ROOT `.env` is the real local database (docker `127.0.0.1:15432/watchdog_bms`).
 * `apps/api/.env` carries a stale `5432/mydb` URL that only the Prisma CLI should ever see.
 */
function rootDatabaseUrl(): string | null {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const env = readFileSync(join(__dirname, '../'.repeat(7), '.env'), 'utf8');
    return /^DATABASE_URL\s*=\s*"?([^"\n]+)"?/m.exec(env)?.[1] ?? null;
  } catch {
    return null;
  }
}

describe('launch-gate command vs bootstrap attestation (real database)', () => {
  let clients: PrismaClient[] = [];
  let actorUserId = '';
  let reachable = false;
  /** Everything this file must put back: the route as it was before the first round. */
  let baseline: { state: string; generation: number; lastSeq: number; reason: string | null } | null = null;

  const where = { gateKey_routeKey: { gateKey: ROUTE.gateKey, routeKey: ROUTE.routeKey } };

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
      // Only rows this file appended live above the baseline sequence; nothing pre-existing is touched.
      await clients[0]!.featureLaunchGateTransition.deleteMany({
        where: { gateKey: ROUTE.gateKey, routeKey: ROUTE.routeKey, seq: { gt: baseline?.lastSeq ?? 0 } },
      });
      // Every command now stores a durable result row (UAT r5 item 2), including the ones this file
      // drives — they are keyed by the tagged commandId, so they come out with everything else.
      await clients[0]!.featureLaunchCommandResult.deleteMany({ where: { commandId: { startsWith: TAG } } });
      await clients[0]!.auditLog.deleteMany({ where: { requestId: { startsWith: TAG } } });
      if (baseline) {
        await clients[0]!.featureLaunchGate.update({ where, data: baseline as any });
      } else {
        await clients[0]!.featureLaunchGate.deleteMany({ where: { gateKey: ROUTE.gateKey, routeKey: ROUTE.routeKey } });
      }
    }
    await Promise.all(clients.map((client) => client.$disconnect()));
  });

  /**
   * Puts the route on a fresh, SYSTEM-opened generation with exactly one attested build, so BOTH
   * writers below have real work to do: the running build has no attestation (the command is a
   * per-build acceptance) and neither has `ROLLING_BUILD` (the bootstrap attests).
   */
  async function seedGeneration(round: number): Promise<number> {
    const lastSeq = (baseline?.lastSeq ?? 0) + 1 + round * 100;
    await clients[0]!.featureLaunchGateTransition.deleteMany({
      where: { gateKey: ROUTE.gateKey, routeKey: ROUTE.routeKey, seq: { gt: baseline?.lastSeq ?? 0 } },
    });
    await clients[0]!.featureLaunchGate.upsert({
      where,
      create: { gateKey: ROUTE.gateKey, routeKey: ROUTE.routeKey, state: 'OPEN', generation: GENERATION + round, lastSeq, reason: TAG },
      update: { state: 'OPEN', generation: GENERATION + round, lastSeq, reason: TAG },
    });
    await clients[0]!.featureLaunchGateTransition.create({
      data: {
        gateKey: ROUTE.gateKey,
        routeKey: ROUTE.routeKey,
        seq: lastSeq,
        generation: GENERATION + round,
        commandId: `${TAG}:baseline:${round}`,
        action: 'OPEN',
        actorUserId: 'SYSTEM',
        payloadFingerprint: `${TAG}:baseline:${round}`,
        targetEnvironment: DEPLOYMENT.targetEnvironment,
        buildReleaseId: BASELINE_BUILD,
        expectedGeneration: GENERATION + round,
        routeClass: 'ORDINARY',
        releaseApprovedByUserId: 'SYSTEM',
      },
    });
    return lastSeq;
  }

  /**
   * The exact failure the owner named: the operator command and the bootstrap attestation both
   * append to one route at once. Before the fix the command's `seq` came from a read taken outside
   * the exclusive lock, so the loser raised `unique constraint "..._seq_key"` instead of committing.
   */
  it('lands BOTH a human command and a bootstrap attestation, at distinct sequences', async (t) => {
    if (!reachable) return t.skip('no database reachable — start docker postgres on 127.0.0.1:15432');

    let commandFirst = 0;
    for (let round = 0; round < RACES; round++) {
      const generation = GENERATION + round;
      const baseSeq = await seedGeneration(round);

      const command = new LaunchGateCommandUseCase({ client: clients[0]! } as any).execute({
        gateKey: ROUTE.gateKey,
        routeKey: ROUTE.routeKey,
        action: 'OPEN',
        commandId: `${TAG}:accept:${round}`,
        actorUserId,
        actorRoles: [LAUNCH_GATE_ADMIN_ROLE],
        actorPermissions: [LAUNCH_GATE_MANAGE_PERMISSION],
        requestId: `${TAG}-${round}`,
        snapshot: { expectedGeneration: generation, emergencyClose: false },
      });
      const attestation = attestOpenOnThisBuild(
        { client: clients[1]! } as any,
        ROUTE,
        { targetEnvironment: DEPLOYMENT.targetEnvironment as any, buildReleaseId: ROLLING_BUILD },
      );

      const [commandResult, attestationResult] = await Promise.all([command, attestation]);
      assert.equal(attestationResult, 'attested', `round ${round}: the bootstrap appended nothing`);
      assert.equal(commandResult.changed, true, `round ${round}: the command appended nothing`);
      // Ruling 2: a per-build acceptance stays on its own generation, so work stamped on the
      // already-accepted builds is not orphaned by admitting another one.
      assert.equal(commandResult.generation, generation, `round ${round}: an acceptance moved the generation`);

      const appended = await clients[0]!.featureLaunchGateTransition.findMany({
        where: { gateKey: ROUTE.gateKey, routeKey: ROUTE.routeKey, seq: { gt: baseSeq } },
        select: { seq: true, action: true, generation: true, buildReleaseId: true, actorUserId: true },
        orderBy: { seq: 'asc' },
      });
      const seqs = appended.map((row) => row.seq);
      assert.equal(new Set(seqs).size, seqs.length, `round ${round}: duplicate seq ${seqs.join(',')}`);
      assert.deepEqual(
        appended.filter((row) => row.action === 'OPEN').map((row) => row.buildReleaseId).sort(),
        [ROLLING_BUILD, DEPLOYMENT.buildReleaseId].sort(),
        `round ${round}: one OPEN per build, exactly once`,
      );
      assert.ok(appended.every((row) => row.generation === generation), `round ${round}: an append moved the generation`);

      const gate = await clients[0]!.featureLaunchGate.findUniqueOrThrow({ where });
      assert.equal(gate.generation, generation, `round ${round}`);
      assert.equal(gate.lastSeq, Math.max(...seqs), `round ${round}: lastSeq does not point at the newest transition`);
      assert.equal(gate.state, 'OPEN', `round ${round}`);
      if (appended[0]!.actorUserId === actorUserId) commandFirst += 1;
    }

    // Both orderings really happened, so neither branch is untested by luck.
    assert.ok(commandFirst > 0 && commandFirst < RACES, `both writers must win sometimes (command first: ${commandFirst}/${RACES})`);
  });

  /**
   * The mutually-idempotent half of the same race: when both writers name the SAME build, exactly
   * one append lands and the loser answers "already open here" instead of colliding or double-opening.
   */
  it('appends once when the command and the bootstrap name the same build', async (t) => {
    if (!reachable) return t.skip('no database reachable');

    for (let round = RACES; round < RACES + 5; round++) {
      const generation = GENERATION + round;
      const baseSeq = await seedGeneration(round);

      const [commandResult, attestationResult] = await Promise.all([
        new LaunchGateCommandUseCase({ client: clients[0]! } as any).execute({
          gateKey: ROUTE.gateKey,
          routeKey: ROUTE.routeKey,
          action: 'OPEN',
          commandId: `${TAG}:same-build:${round}`,
          actorUserId,
          actorRoles: [LAUNCH_GATE_ADMIN_ROLE],
          actorPermissions: [LAUNCH_GATE_MANAGE_PERMISSION],
          requestId: `${TAG}-same-${round}`,
          snapshot: { expectedGeneration: generation, emergencyClose: false },
        }),
        attestOpenOnThisBuild({ client: clients[1]! } as any, ROUTE, DEPLOYMENT),
      ]);

      const appended = await clients[0]!.featureLaunchGateTransition.findMany({
        where: { gateKey: ROUTE.gateKey, routeKey: ROUTE.routeKey, seq: { gt: baseSeq } },
        select: { seq: true, buildReleaseId: true },
      });
      assert.equal(appended.length, 1, `round ${round}: the same build was opened twice`);
      assert.equal(appended[0]!.buildReleaseId, DEPLOYMENT.buildReleaseId);
      // Whichever lost saw the winner's row under the lock and reported "nothing to do".
      assert.equal(commandResult.changed === false || attestationResult === 'current', true, `round ${round}`);
    }
  });
});
