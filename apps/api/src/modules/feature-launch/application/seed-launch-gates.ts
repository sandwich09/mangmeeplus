/**
 * Deploy-owned launch-gate bootstrap (spec:66, plan §3 F1).
 *
 * Materializes one `FeatureLaunchGate` row per CONCRETE FEATURE_LAUNCH_MATRIX row:
 *   - 16 ORDINARY rows are opened through a normal-OPEN-shaped SYSTEM command, because they are
 *     features already proven live today and F2 grandfathers existing effective access (spec:236).
 *   - 4 concrete SPECIALIST_LEGAL / deferred rows are materialized as seeded-CLOSED baselines: the
 *     row exists so the health view can show it, and it has never been opened. No CLOSE transition
 *     is written — CLOSED→CLOSED is not a real transition and must not move the generation.
 *   - Namespace rows whose `routeKey` is a `<...>` template are never materialized; each is
 *     returned with its reason so the skip is recorded rather than silent.
 *
 * Safe to re-run, and safe to run AFTER an operator has taken control: a route that already carries
 * a recorded transition is never reopened by a deploy, so an emergency CLOSE survives the next
 * release.
 *
 * On every later run it also re-attests, on the CURRENT build, the rows it opened itself — see
 * `attestOpenOnThisBuild`. That is what lets the build-bound guard keep admitting the grandfathered
 * DEFAULT features across deploys without a deploy ever standing in for a human approval.
 */
import { resolveDeploymentIdentity, type DeploymentIdentity } from '@watchdog-bms/config';
import type { PrismaService } from '../../../common/database/prisma.service';
import {
  LAUNCH_GATE_SEED_BUILD_RELEASE_ID,
  MATERIALIZABLE_LAUNCH_MATRIX_ROWS,
  NON_MATERIALIZABLE_LAUNCH_MATRIX_ROWS,
  type LaunchMatrixRow,
} from '../domain/launch-matrix.catalog';
import { exclusiveLaunchGateLock } from './execution-attempt.service';
import { isOpenOnDeployment } from './launch-gate.guard';
import { LAUNCH_GATE_SYSTEM_ACTOR, LaunchGateCommandUseCase } from './use-cases/launch-gate-command.use-case';

/** Why the bootstrap walked away from an existing row it did not open (spec:66). */
const CLOSED_BY_TRANSITION_REASON = 'closed by a recorded control-plane transition — the bootstrap never reopens a route';

export type SeedLaunchGatesResult = {
  opened: string[];
  closedBaseline: string[];
  /** Already in the seeded state — the second run of an unchanged bootstrap. */
  unchanged: string[];
  /** SYSTEM-seeded OPEN rows re-attested on THIS build so the guard keeps admitting them (F1.5.1). */
  attested: string[];
  skipped: Array<{ gateKey: string; routeKey: string; reason: string }>;
};

export type SeedLaunchGatesOptions = {
  log?: (message: string) => void;
};

export async function seedLaunchGates(
  prisma: PrismaService,
  options: SeedLaunchGatesOptions = {},
): Promise<SeedLaunchGatesResult> {
  const log = options.log ?? (() => {});
  const command = new LaunchGateCommandUseCase(prisma);

  const deployment = resolveDeploymentIdentity(process.env);

  const result: SeedLaunchGatesResult = {
    opened: [],
    closedBaseline: [],
    unchanged: [],
    attested: [],
    skipped: NON_MATERIALIZABLE_LAUNCH_MATRIX_ROWS.map((row) => ({
      gateKey: row.gateKey,
      routeKey: row.routeKey,
      reason: row.notMaterializableReason ?? 'not materializable',
    })),
  };

  for (const row of MATERIALIZABLE_LAUNCH_MATRIX_ROWS) {
    const label = `${row.gateKey}/${row.routeKey}`;
    const gate = await prisma.client.featureLaunchGate.findUnique({
      where: { gateKey_routeKey: { gateKey: row.gateKey, routeKey: row.routeKey } },
      select: { state: true, generation: true, lastSeq: true },
    });

    if (row.seedState === 'CLOSED') {
      // Upsert with an empty update: a baseline row is created once and never re-closed, so a
      // legitimately opened specialist route is not slammed shut by the next deploy.
      await prisma.client.featureLaunchGate.upsert({
        where: { gateKey_routeKey: { gateKey: row.gateKey, routeKey: row.routeKey } },
        create: {
          gateKey: row.gateKey,
          routeKey: row.routeKey,
          state: 'CLOSED',
          reason: `${LAUNCH_GATE_SEED_BUILD_RELEASE_ID} baseline — never opened`,
        },
        update: {},
      });
      if (gate) result.unchanged.push(label);
      else result.closedBaseline.push(label);
      continue;
    }

    if (gate?.state === 'OPEN') {
      const outcome = await attestOpenOnThisBuild(prisma, row, deployment);
      if (outcome === 'attested') result.attested.push(label);
      else if (outcome === 'human-opened') {
        result.skipped.push({
          gateKey: row.gateKey,
          routeKey: row.routeKey,
          reason: 'opened by a human command on another build — a deploy never re-attests a human approval; re-OPEN it on this build',
        });
      } else if (outcome === 'closed') {
        // The row was CLOSED between this read and the lock. The lock holder's view is the truth.
        result.skipped.push({ gateKey: row.gateKey, routeKey: row.routeKey, reason: CLOSED_BY_TRANSITION_REASON });
      } else result.unchanged.push(label);
      continue;
    }
    if (gate && gate.lastSeq > 0) {
      // CLOSED by a recorded control-plane transition (an emergency CLOSE, or a deliberate one).
      // Reopening is a fresh human command with fresh build/evidence/approval — never a deploy.
      result.skipped.push({ gateKey: row.gateKey, routeKey: row.routeKey, reason: CLOSED_BY_TRANSITION_REASON });
      continue;
    }

    const expectedGeneration = gate?.generation ?? 0;
    await command.execute({
      gateKey: row.gateKey,
      routeKey: row.routeKey,
      action: 'OPEN',
      // The generation is part of the key so a later legitimate reopen is a DISTINCT command rather
      // than key reuse with a changed payload.
      commandId: `${LAUNCH_GATE_SEED_BUILD_RELEASE_ID}:${row.gateKey}:${row.routeKey}:g${expectedGeneration}`,
      actorUserId: LAUNCH_GATE_SYSTEM_ACTOR,
      // The deploy-owned bootstrap has no session; SYSTEM is the only actor allowed to carry none.
      actorRoles: [],
      actorPermissions: [],
      requestId: `${LAUNCH_GATE_SEED_BUILD_RELEASE_ID}-bootstrap`,
      reason: 'F1 bootstrap: feature already live before launch gating (spec:236 grandfather)',
      snapshot: {
        // P0-3: environment and build are server-derived from the deployment, so the seeded
        // transition records the REAL deployment it ran on rather than a literal.
        expectedGeneration,
        emergencyClose: false,
        // The seed baseline is a system grandfather of an already-live feature, not a human release
        // sign-off. Every LATER open is an ordinary command and must carry a real approver.
        releaseApprovedByUserId: LAUNCH_GATE_SYSTEM_ACTOR,
      },
    });
    result.opened.push(label);
  }

  log(
    `launch gates: opened=${result.opened.length} closed-baseline=${result.closedBaseline.length} `
    + `unchanged=${result.unchanged.length} attested=${result.attested.length} skipped=${result.skipped.length}`,
  );
  return result;
}

/**
 * F1.5.1 item 4 — per-build attestation. `LaunchGateGuardService` requires an OPEN of the row's
 * current generation to name the RUNNING environment and build, so an already-OPEN row would go
 * dark on the next deploy. For rows this bootstrap itself opened (ORDINARY, SYSTEM lineage) that
 * would be theatre: the deploy re-states, on the new build, exactly the grandfather it stated on the
 * old one. So it appends one SYSTEM attestation transition instead of fabricating a human approval.
 *
 * Three invariants make this safe rather than a back door:
 *  - only an ORDINARY row whose CURRENT generation was opened by SYSTEM is ever attested. A human
 *    approval, and every SPECIALIST_LEGAL row, is left to expire — the operator must re-OPEN.
 *  - the GENERATION never moves. An attestation is not a state change: bumping the generation would
 *    invalidate the availability vector every in-flight `ExecutionAttempt` stamped (spec:59-63) and
 *    strand real queued work on every deploy. Only `lastSeq` advances, so the append-only child
 *    keeps its per-route sequence.
 *  - F1.5.2 — the WHOLE decision (state, generation, lineage, "already attested") is read under the
 *    exclusive advisory lock. Reading the lineage before the lock and re-checking only the state
 *    inside it let a human CLOSE + re-OPEN-on-a-new-build interleave: the deploy would then stamp a
 *    SYSTEM attestation for ITS build onto the generation a person had just approved for another —
 *    reviving build A under build B's approval. Nothing outside the lock decides anything now.
 *
 * Attestations for several builds coexist inside one generation on purpose: a rolling deploy runs
 * builds A and B at once, and each attestation admits only its own runtime. The window is bounded at
 * {current, previous} by the POST-deploy `retireLaunchBuilds` pass (UAT r5 item 1), which retires
 * every attested build that is not among the ones actually serving after health verification — this
 * bootstrap only ever appends, because it runs before the new build serves a single request.
 *
 * Item 6 — that bound applies to human approvals too, but the way BACK does not: a SYSTEM-lineage
 * route is re-attested here by the next verified deployment, while a human/specialist one is left
 * `human-opened` forever and needs a fresh human command. A deploy never re-states a person's approval.
 */
export async function attestOpenOnThisBuild(
  prisma: PrismaService,
  row: LaunchMatrixRow,
  /** A parameter, not `process.env`: during a rolling deploy the OTHER task's release job attests
   * ITS build against the same route, which is exactly what the real-database race spec drives. */
  deployment: DeploymentIdentity,
): Promise<'current' | 'attested' | 'human-opened' | 'closed'> {
  return prisma.client.$transaction(async (tx) => {
    // The same exclusive lock every real transition takes (spec:60), so read-decide-append cannot
    // race another deploy, or an operator command, on this route.
    await tx.$executeRaw(exclusiveLaunchGateLock(row.gateKey, row.routeKey));
    const current = await tx.featureLaunchGate.findUnique({
      where: { gateKey_routeKey: { gateKey: row.gateKey, routeKey: row.routeKey } },
      select: { state: true, generation: true, lastSeq: true },
    });
    if (current?.state !== 'OPEN') return 'closed';

    // Idempotency is the guard's own authority rule, not a commandId lookup: if anything already
    // admits this deployment at this generation — the real OPEN of a first-run bootstrap, or an
    // earlier attestation that has not been retired — there is nothing to state.
    if (await isOpenOnDeployment(tx, row.gateKey, row.routeKey, current.generation, deployment)) return 'current';

    // The lineage of a generation is the OPEN that CREATED it, and attestations never create one, so
    // it is the FIRST OPEN at this generation. Anything later at the same generation is an
    // attestation of that same approval.
    const openedOn = await tx.featureLaunchGateTransition.findFirst({
      where: { gateKey: row.gateKey, routeKey: row.routeKey, action: 'OPEN', generation: current.generation },
      orderBy: { seq: 'asc' },
      select: { actorUserId: true },
    });
    if (row.routeClass !== 'ORDINARY' || openedOn?.actorUserId !== LAUNCH_GATE_SYSTEM_ACTOR) return 'human-opened';

    // UAT r5 item 1 — the PRE-deploy release task only APPENDS. It runs before a single task of this
    // build is serving, so retiring the outgoing build here would destroy the authority of the
    // runtime still taking traffic if the rollout never became healthy. Bounding the window is the
    // post-deploy `retireLaunchBuilds` pass, driven by the builds actually running.
    const seq = current.lastSeq + 1;
    // The generation AND the seq are part of the key: one build may legitimately attest two
    // generations of the same route over its lifetime, and may be retired and re-attested on one
    // generation after a rollback, while `(gateKey, routeKey, commandId)` stays unique.
    const commandId = `${LAUNCH_GATE_SEED_BUILD_RELEASE_ID}:attest:${deployment.targetEnvironment}:`
      + `${deployment.buildReleaseId}:g${current.generation}:s${seq}`;
    await tx.featureLaunchGateTransition.create({
      data: {
        gateKey: row.gateKey,
        routeKey: row.routeKey,
        seq,
        generation: current.generation,
        commandId,
        action: 'OPEN',
        actorUserId: LAUNCH_GATE_SYSTEM_ACTOR,
        payloadFingerprint: commandId,
        reason: 'F1 bootstrap: per-build attestation of a SYSTEM-seeded OPEN (no state change)',
        targetEnvironment: deployment.targetEnvironment,
        buildReleaseId: deployment.buildReleaseId,
        expectedGeneration: current.generation,
        routeClass: row.routeClass,
        releaseApprovedByUserId: LAUNCH_GATE_SYSTEM_ACTOR,
        emergencyClose: false,
      },
    });
    await tx.featureLaunchGate.update({
      where: { gateKey_routeKey: { gateKey: row.gateKey, routeKey: row.routeKey } },
      data: { lastSeq: seq },
    });
    return 'attested';
  });
}
