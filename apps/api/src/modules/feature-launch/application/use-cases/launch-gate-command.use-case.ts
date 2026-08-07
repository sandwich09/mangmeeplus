/**
 * CC1 launch-gate control-plane command (spec:53-55).
 *
 * Order is normative: command lookup by (gateKey, routeKey, commandId) happens BEFORE the
 * expected-generation CAS, so a same-key/same-fingerprint/same-action retry replays the original
 * result, key reuse with another payload/action rejects, and a delayed command carrying a stale
 * expected generation can never reopen or close the row.
 *
 * F1.5.2 owner ruling 3 — that whole order now runs INSIDE the transaction, after the exclusive
 * route lock. The command lookup, the gate read, the attestation check and the `seq` computation
 * used to happen before it, while the bootstrap appends attestations (advancing `lastSeq` without
 * moving the generation) on the same route: two writers then computed the same `seq` and the loser
 * raised a raw unique violation no caller could act on. Nothing outside the lock decides anything.
 *
 * F1.5.2 owner ruling 2 — GENERATION SEMANTICS. The generation moves ONLY on a real state change:
 *
 *   state    | command | result
 *   ---------+---------+-----------------------------------------------------------------
 *   CLOSED   | OPEN    | transition + snapshot + audit, generation +1, changed
 *   OPEN     | CLOSE   | transition + snapshot + audit, generation +1, changed
 *   OPEN     | OPEN    | this deployment already live at this generation → no-op, unchanged
 *   OPEN     | OPEN    | another build/environment → per-build ACCEPTANCE: transition +
 *            |         | snapshot + audit at the SAME generation, changed
 *   CLOSED   | CLOSE   | no-op, unchanged (CLOSED→CLOSED carries no deployment claim)
 *
 * An acceptance is what lets a human admit a new build without orphaning the work already stamped
 * on the accepted ones — the availability vector of every in-flight `ExecutionAttempt` is keyed on
 * the generation, so bumping it here would strand real queued work on every re-approval. To kill
 * old work the operator issues an explicit CLOSE and then an OPEN; each of those bumps.
 *
 * UAT r5 item 2 — EVERY command stores a durable `FeatureLaunchCommandResult`, no-ops included. A
 * no-op used to return without recording anything, so a delayed retry of that same command could
 * arrive after its build had been RETIRED, find the deployment no longer admitted, and be taken for
 * a fresh per-build acceptance — re-admitting a build nobody re-approved. The stored result is now
 * the answer to any repeat of the same commandId, and it is read before authority is touched.
 *
 * UAT r5 item 1 — this command no longer RETIRES anything. Bounding the window is a post-deploy pass
 * driven by the builds actually serving (`retireLaunchBuilds`); a write path can only ever guess.
 *
 * Internal-only: this use case is reachable from the system-admin control-plane controller and the
 * deploy-owned bootstrap. Customer, partner, tenant-user and AI surfaces never call it (AC29).
 */
import { ConflictException, ForbiddenException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { resolveDeploymentIdentity } from '@watchdog-bms/config';
import type { Prisma } from '../../../../generated/prisma/client';
import { PrismaService } from '../../../../common/database/prisma.service';
import { findLaunchMatrixRow, type LaunchGateState } from '../../domain/launch-matrix.catalog';
import { exclusiveLaunchGateLock } from '../execution-attempt.service';
import { isOpenOnDeployment } from '../launch-gate.guard';
import {
  launchGatePayloadFingerprint,
  launchGateSnapshotViolations,
  type ControlPlaneSnapshotInput,
  type ControlPlaneSnapshotRequest,
  type LaunchGateAction,
} from '../../domain/logic/launch-gate-snapshot.logic';

/** The literal actor recorded for a bootstrap/automation transition (spec:53). */
export const LAUNCH_GATE_SYSTEM_ACTOR = 'SYSTEM';

/** The only role that may command the launch control plane, plus the permission it must hold. */
export const LAUNCH_GATE_ADMIN_ROLE = 'SYSTEM_ADMIN';
export const LAUNCH_GATE_MANAGE_PERMISSION = 'system.launch_gate.manage';

export type LaunchGateCommand = {
  gateKey: string;
  routeKey: string;
  action: LaunchGateAction;
  /** Whole-command idempotency key (spec:53). */
  commandId: string;
  /** User id, or the literal 'SYSTEM' for the deploy-owned bootstrap. */
  actorUserId: string;
  /** The AUTHENTICATED actor's roles/permissions. Empty is only valid for the SYSTEM bootstrap. */
  actorRoles: readonly string[];
  actorPermissions: readonly string[];
  requestId: string;
  reason?: string;
  snapshot: ControlPlaneSnapshotRequest;
};

export type LaunchGateCommandResult = {
  gateKey: string;
  routeKey: string;
  action: LaunchGateAction;
  state: LaunchGateState;
  generation: number;
  lastSeq: number;
  /** false when the row was already in the target state — not a real transition (spec:53). */
  changed: boolean;
  /** true when the stored result of an earlier identical command was returned. */
  replayed: boolean;
};

@Injectable()
export class LaunchGateCommandUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(cmd: LaunchGateCommand): Promise<LaunchGateCommandResult> {
    // The matrix is authoritative for the route catalog and its class (runbook §2.1), so the
    // caller cannot declare a route ORDINARY to dodge the specialist evidence requirement.
    const matrixRow = findLaunchMatrixRow(cmd.gateKey, cmd.routeKey);
    if (!matrixRow) {
      throw new UnprocessableEntityException({
        code: 'unknown_launch_route',
        message: `(${cmd.gateKey}, ${cmd.routeKey}) is not a FEATURE_LAUNCH_MATRIX route.`,
        gateKey: cmd.gateKey,
        routeKey: cmd.routeKey,
      });
    }
    // P0-3(d) — a row spec:272 forbids has no openable shape at all in v5.1. Checked FIRST, so no
    // approval, evidence hash or emergency framing can reach a path that could open it.
    if (cmd.action === 'OPEN' && matrixRow.openPolicy === 'FORBIDDEN_V5_1') {
      throw new UnprocessableEntityException({
        code: 'launch_route_open_forbidden',
        message: `(${cmd.gateKey}, ${cmd.routeKey}) has no OPEN row in v5.1 (spec:272); it stays CLOSED until a future version.`,
        gateKey: cmd.gateKey,
        routeKey: cmd.routeKey,
        openPolicy: matrixRow.openPolicy,
      });
    }
    // A BLOCKED matrix row must never be OPEN (plan §3 F0) — checked before materializability so
    // the answer names the real reason rather than the storage consequence.
    if (cmd.action === 'OPEN' && matrixRow.matrixRowStatus === 'BLOCKED') {
      throw new UnprocessableEntityException({
        code: 'launch_route_blocked',
        message: `(${cmd.gateKey}, ${cmd.routeKey}) is BLOCKED in FEATURE_LAUNCH_MATRIX and cannot be opened.`,
        gateKey: cmd.gateKey,
        routeKey: cmd.routeKey,
      });
    }
    // F1.5.1 item 1 — the specialist door is CLOSED, not merely guarded. The persisted
    // specialist-approval record that a real SPECIALIST_LEGAL OPEN must bind to does not exist yet
    // (F1.6), so no command shape can express one: `specialistApprovedByUserId` could only ever be
    // the actor, `validationEvidenceRef`/`Hash` are any non-empty strings the caller types, and one
    // SYSTEM_ADMIN could therefore sign as release owner AND specialist over evidence nobody
    // verified. Rejecting every such OPEN — perfect shape included — is the only honest answer
    // until the record exists. CLOSE (ordinary and emergency) is unaffected: a route that cannot be
    // opened must still be closeable.
    if (cmd.action === 'OPEN' && matrixRow.routeClass === 'SPECIALIST_LEGAL') {
      throw new UnprocessableEntityException({
        code: 'launch_route_specialist_approval_unavailable',
        message: `(${cmd.gateKey}, ${cmd.routeKey}) is a SPECIALIST_LEGAL route and cannot be opened by any command in v5.1: `
          + 'no persisted specialist-approval record exists to bind the approval to (F1.6).',
        gateKey: cmd.gateKey,
        routeKey: cmd.routeKey,
        routeClass: matrixRow.routeClass,
        // What a future OPEN must present. Stated here so the rejection is a requirement, not a wall.
        requires: [
          'a persisted specialist-approval record naming this exact gateKey and routeKey',
          'the current FEATURE_LAUNCH_MATRIX evidence hash for that row',
          'a real validation-evidence artifact reference, resolvable and hash-matched',
          'an approver holding the specialist role for this route class',
          'that approver DISTINCT from the release owner issuing the command',
          'an expiry, bound to the target build and deployment environment',
        ],
      });
    }
    if (!matrixRow.materializable) {
      throw new UnprocessableEntityException({
        code: 'launch_route_not_materializable',
        message: matrixRow.notMaterializableReason ?? 'This matrix row cannot own a launch-gate row.',
        gateKey: cmd.gateKey,
        routeKey: cmd.routeKey,
      });
    }

    // P0-3 — from here on the snapshot is SERVER-OWNED. `cmd.snapshot` is never read again.
    const snapshot = this.authoritativeSnapshot(cmd);

    const violations = launchGateSnapshotViolations(cmd.action, matrixRow.routeClass, snapshot);
    if (violations.length > 0) {
      throw new UnprocessableEntityException({
        code: 'launch_gate_snapshot_invalid',
        message: violations.join(' '),
        violations,
      });
    }

    const payloadFingerprint = launchGatePayloadFingerprint(cmd.action, snapshot);
    const targetState: LaunchGateState = cmd.action === 'OPEN' ? 'OPEN' : 'CLOSED';

    return this.prisma.client.$transaction(async (tx) => {
      // The exclusive half of the CC1 claim protocol (spec:60): an `ExecutionAttempt` claim takes
      // the SHARED side of this exact route key, so a CLOSE racing a claim is linearized — the
      // claim either sees the CLOSE or is already recorded. Shared claimants never block each
      // other, so many tenants do not serialize on one global gate.
      //
      // Owner ruling 3 — it is taken FIRST, before anything is read. The bootstrap appends
      // attestations under this same lock and advances `lastSeq` without moving the generation, so a
      // `seq` computed outside it is stale by construction and collides on `(gateKey, routeKey, seq)`.
      await tx.$executeRaw(exclusiveLaunchGateLock(cmd.gateKey, cmd.routeKey));

      // spec:53 — command lookup BEFORE CAS, and item 2: the COMMAND RESULT row is the stored answer
      // for every command, no-ops included. Replay returns it verbatim and touches no authority: not
      // the gate row, not a transition, not an attestation. A retry that arrives after its build was
      // retired therefore replays "nothing happened" instead of being re-read as a fresh acceptance.
      const stored = await tx.featureLaunchCommandResult.findUnique({
        where: {
          gateKey_routeKey_commandId: { gateKey: cmd.gateKey, routeKey: cmd.routeKey, commandId: cmd.commandId },
        },
        select: { action: true, state: true, generation: true, lastSeq: true, resultKind: true, payloadFingerprint: true },
      });
      if (stored) {
        assertSameCommand(cmd.commandId, stored, payloadFingerprint, cmd.action);
        return {
          gateKey: cmd.gateKey,
          routeKey: cmd.routeKey,
          action: stored.action as LaunchGateAction,
          state: stored.state as LaunchGateState,
          generation: stored.generation,
          lastSeq: stored.lastSeq,
          changed: stored.resultKind !== 'NOOP',
          replayed: true,
        };
      }
      // Commands recorded BEFORE the result table existed have only their transition row. Without
      // this fallback their replay would fall through and collide on `(gateKey, routeKey, commandId)`
      // as a raw unique violation. New commands never reach it — they always write a result row.
      const legacy = await tx.featureLaunchGateTransition.findUnique({
        where: {
          gateKey_routeKey_commandId: { gateKey: cmd.gateKey, routeKey: cmd.routeKey, commandId: cmd.commandId },
        },
        select: {
          action: true,
          seq: true,
          generation: true,
          expectedGeneration: true,
          payloadFingerprint: true,
          targetEnvironment: true,
          buildReleaseId: true,
        },
      });
      if (legacy) {
        assertSameCommand(cmd.commandId, legacy, payloadFingerprint, cmd.action);
        const state: LaunchGateState = legacy.action === 'OPEN' ? 'OPEN' : 'CLOSED';
        // UAT r8 — every command is DURABLE, and answering from the transition alone left the
        // pre-migration ones permanently absent from the results table: unenumerable, and dependent
        // on the transition row forever. The backfill happens under the same route lock and in the
        // same transaction as the answer it describes, and it runs at most once — the next replay of
        // this commandId is served by the `stored` branch above.
        //
        // Only real commands can get here: a retirement marker and a bootstrap attestation both
        // store their own commandId as `payloadFingerprint`, never the snapshot hash this command
        // computes, so `assertSameCommand` rejects them before this line. What survives the check is
        // by construction a command that ran through this use case with this exact payload — and its
        // kind is derived the same way a fresh apply derives it: the generation moved (APPLIED) or
        // it was a per-build acceptance on the generation it already had (ACCEPTED).
        //
        // The deployment identity comes from the TRANSITION, never from this process. A result row
        // records where its command RAN, and a fresh one is written once and never rewritten by a
        // replay — so a backfill that stamped the replaying build would make the historical command
        // the only row in the table that names a build it never executed on.
        await recordCommandResult(
          tx,
          cmd,
          { ...snapshot, targetEnvironment: legacy.targetEnvironment, buildReleaseId: legacy.buildReleaseId },
          payloadFingerprint,
          {
            resultKind: legacy.generation === legacy.expectedGeneration ? 'ACCEPTED' : 'APPLIED',
            state,
            generation: legacy.generation,
            lastSeq: legacy.seq,
          },
        );
        return {
          gateKey: cmd.gateKey,
          routeKey: cmd.routeKey,
          action: legacy.action as LaunchGateAction,
          state,
          generation: legacy.generation,
          lastSeq: legacy.seq,
          changed: true,
          replayed: true,
        };
      }

      // Materialize the row lazily at CLOSED/generation 0 (schema default). Upsert, never
      // create-then-catch-P2002 — a caught P2002 poisons the surrounding transaction (25P02).
      const gate = await tx.featureLaunchGate.upsert({
        where: { gateKey_routeKey: { gateKey: cmd.gateKey, routeKey: cmd.routeKey } },
        create: { gateKey: cmd.gateKey, routeKey: cmd.routeKey },
        update: {},
        select: { state: true, generation: true, lastSeq: true },
      });

      const expectedGeneration = snapshot.expectedGeneration;
      if (expectedGeneration !== gate.generation) {
        throw new ConflictException({
          code: 'launch_gate_generation_conflict',
          message: 'The launch route changed since it was read. Re-read the gate and retry.',
          gateKey: cmd.gateKey,
          routeKey: cmd.routeKey,
          expectedGeneration,
          currentGeneration: gate.generation,
        });
      }

      // Already in the target state — but "already OPEN" is not one fact, it is two (F1.5.2):
      //
      //  - OPEN on a row this deployment ALREADY holds a LIVE OPEN/attestation for at the current
      //    generation: a true idempotent retry. No transition, no generation move (spec:53), which is
      //    what keeps the bootstrap a no-op on its second run even under a fresh commandId.
      //  - OPEN naming a build or environment this generation has not accepted: a per-build
      //    ACCEPTANCE (owner ruling 2). It appends a real transition + snapshot + audit at the SAME
      //    generation, so the new build is admitted while work already stamped on the accepted
      //    builds keeps its availability vector. Killing that work is an explicit CLOSE then OPEN.
      //
      // CLOSE is unconditional here: CLOSED→CLOSED carries no deployment claim and is never real.
      const idempotent = gate.state === targetState
        && (cmd.action === 'CLOSE' || await isOpenOnDeployment(tx, cmd.gateKey, cmd.routeKey, gate.generation, snapshot));
      if (idempotent) {
        // Item 2 — a no-op is a RESULT, not an absence of one. Recorded durably so this commandId
        // can never be answered a second time by re-deciding against a moved world.
        await recordCommandResult(tx, cmd, snapshot, payloadFingerprint, {
          resultKind: 'NOOP',
          state: gate.state as LaunchGateState,
          generation: gate.generation,
          lastSeq: gate.lastSeq,
        });
        return {
          gateKey: cmd.gateKey,
          routeKey: cmd.routeKey,
          action: cmd.action,
          state: gate.state as LaunchGateState,
          generation: gate.generation,
          lastSeq: gate.lastSeq,
          changed: false,
          replayed: false,
        };
      }

      // The generation moves only on a real state change; an acceptance stays on its own generation.
      const nextGeneration = gate.state === targetState ? gate.generation : gate.generation + 1;
      // Item 1 — nothing is retired here. This command only ever APPENDS its own authority; taking
      // authority away is the post-deploy pass, which knows what is actually serving.
      const seq = gate.lastSeq + 1;

      // Conditional CAS on the generation read above: a racing command commits first and this one
      // matches zero rows rather than silently overwriting it.
      const cas = await tx.featureLaunchGate.updateMany({
        where: { gateKey: cmd.gateKey, routeKey: cmd.routeKey, generation: expectedGeneration },
        data: { state: targetState, generation: nextGeneration, lastSeq: seq, reason: cmd.reason ?? null },
      });
      if (cas.count !== 1) {
        throw new ConflictException({
          code: 'launch_gate_generation_conflict',
          message: 'The launch route changed while saving. Re-read the gate and retry.',
          gateKey: cmd.gateKey,
          routeKey: cmd.routeKey,
          expectedGeneration,
        });
      }

      await tx.featureLaunchGateTransition.create({
        data: {
          gateKey: cmd.gateKey,
          routeKey: cmd.routeKey,
          seq,
          generation: nextGeneration,
          commandId: cmd.commandId,
          action: cmd.action,
          actorUserId: cmd.actorUserId,
          payloadFingerprint,
          reason: cmd.reason ?? null,
          targetEnvironment: snapshot.targetEnvironment,
          buildReleaseId: snapshot.buildReleaseId,
          expectedGeneration,
          routeClass: matrixRow.routeClass,
          validationEvidenceRef: snapshot.validationEvidenceRef ?? null,
          validationEvidenceHash: snapshot.validationEvidenceHash ?? null,
          specialistApprovedByUserId: snapshot.specialistApprovedByUserId ?? null,
          releaseApprovedByUserId: snapshot.releaseApprovedByUserId ?? null,
          emergencyClose: snapshot.emergencyClose === true,
          emergencyAuthorityUserId: snapshot.emergencyAuthorityUserId ?? null,
          incidentRef: snapshot.incidentRef ?? null,
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: cmd.actorUserId === LAUNCH_GATE_SYSTEM_ACTOR ? null : cmd.actorUserId,
          actorType: cmd.actorUserId === LAUNCH_GATE_SYSTEM_ACTOR ? 'SYSTEM' : 'USER',
          action: cmd.action === 'OPEN' ? 'system.launch_gate.open' : 'system.launch_gate.close',
          targetType: 'launch_gate',
          targetId: `${cmd.gateKey}:${cmd.routeKey}`,
          requestId: cmd.requestId,
          result: 'SUCCESS',
          // Both approval roles and the evidence travel with the audit entry (spec:55).
          riskLevel: 'HIGH',
          metadataJson: {
            commandId: cmd.commandId,
            seq,
            generation: nextGeneration,
            expectedGeneration,
            routeClass: matrixRow.routeClass,
            targetEnvironment: snapshot.targetEnvironment,
            buildReleaseId: snapshot.buildReleaseId,
            releaseApprovedByUserId: snapshot.releaseApprovedByUserId ?? null,
            specialistApprovedByUserId: snapshot.specialistApprovedByUserId ?? null,
            validationEvidenceRef: snapshot.validationEvidenceRef ?? null,
            validationEvidenceHash: snapshot.validationEvidenceHash ?? null,
            emergencyClose: snapshot.emergencyClose === true,
            emergencyAuthorityUserId: snapshot.emergencyAuthorityUserId ?? null,
            incidentRef: snapshot.incidentRef ?? null,
          },
        },
      });

      // ACCEPTED when the row was already in the target state — a per-build acceptance at the SAME
      // generation; APPLIED when the state (and therefore the generation) really moved.
      await recordCommandResult(tx, cmd, snapshot, payloadFingerprint, {
        resultKind: nextGeneration === expectedGeneration ? 'ACCEPTED' : 'APPLIED',
        state: targetState,
        generation: nextGeneration,
        lastSeq: seq,
      });

      return {
        gateKey: cmd.gateKey,
        routeKey: cmd.routeKey,
        action: cmd.action,
        state: targetState,
        generation: nextGeneration,
        lastSeq: seq,
        changed: true,
        replayed: false,
      };
    });
  }

  /**
   * P0-3 — the control-plane trust boundary. Everything authority-bearing in the persisted snapshot
   * is derived here, from the deployment and the authenticated actor:
   *
   *  (a) `targetEnvironment` / `buildReleaseId` come from `DEPLOY_ENVIRONMENT` +
   *      `GIT_SHA`/`IMAGE_DIGEST`. A caller may send them as an EXPECTED value — a CAS that binds
   *      the command to the deployment it was approved against — or omit them; it can never set
   *      them. This is what makes "an old approval never reopens a new generation" enforceable.
   *  (b) `releaseApprovedByUserId` is ALWAYS the authenticated actor, who must hold SYSTEM_ADMIN +
   *      `system.launch_gate.manage` (the controller guard enforces the same permission; this is
   *      the second, use-case-level check so the bootstrap path cannot bypass it either).
   *  (c) `emergencyAuthorityUserId` is likewise the actor — an on-call operator cannot name someone
   *      else as the shutdown authority.
   *
   * TODO-F1.6: `specialistApprovedByUserId` must reference a PERSISTED specialist-approval record
   * (approver distinct from the release owner, exact route, matrix evidence hash, artifact ref,
   * expiry, build/environment) resolved here. No such model exists yet — so rather than accept the
   * weaker "the specialist IS the actor" rule and leave one SYSTEM_ADMIN able to sign both roles,
   * `execute` HARD-REJECTS every SPECIALIST_LEGAL OPEN above this line. The residual is closed, not
   * documented. The actor rule below still applies to whatever a CLOSE carries.
   */
  private authoritativeSnapshot(cmd: LaunchGateCommand): ControlPlaneSnapshotInput {
    // The deploy-owned bootstrap runs as SYSTEM with no session; every other actor is a real user
    // and must carry the platform role AND the permission.
    if (cmd.actorUserId !== LAUNCH_GATE_SYSTEM_ACTOR
      && !(cmd.actorRoles.includes(LAUNCH_GATE_ADMIN_ROLE) && cmd.actorPermissions.includes(LAUNCH_GATE_MANAGE_PERMISSION))) {
      throw new ForbiddenException({
        code: 'launch_gate_actor_not_authorized',
        message: `A launch-gate command requires the ${LAUNCH_GATE_ADMIN_ROLE} role with ${LAUNCH_GATE_MANAGE_PERMISSION}.`,
      });
    }

    const deployment = resolveDeploymentIdentity(process.env);
    expectServerValue('targetEnvironment', cmd.snapshot.targetEnvironment, deployment.targetEnvironment);
    expectServerValue('buildReleaseId', cmd.snapshot.buildReleaseId, deployment.buildReleaseId);
    expectActor('releaseApprovedByUserId', cmd.snapshot.releaseApprovedByUserId, cmd.actorUserId);
    expectActor('specialistApprovedByUserId', cmd.snapshot.specialistApprovedByUserId, cmd.actorUserId);
    expectActor('emergencyAuthorityUserId', cmd.snapshot.emergencyAuthorityUserId, cmd.actorUserId);

    const emergency = cmd.snapshot.emergencyClose === true;
    return {
      ...cmd.snapshot,
      targetEnvironment: deployment.targetEnvironment,
      buildReleaseId: deployment.buildReleaseId,
      // An emergency CLOSE records no release approval (spec:54 lets it omit one so shutdown is
      // never delayed); it records the on-call actor as the emergency authority instead.
      releaseApprovedByUserId: emergency ? null : cmd.actorUserId,
      specialistApprovedByUserId: cmd.snapshot.specialistApprovedByUserId == null ? null : cmd.actorUserId,
      // Left as sent when this is not an emergency, so the "only valid with emergencyClose=true"
      // shape violation still fires instead of being silently normalized away.
      emergencyAuthorityUserId: emergency ? cmd.actorUserId : (cmd.snapshot.emergencyAuthorityUserId ?? null),
    };
  }
}

/**
 * Item 2 — the durable answer for ONE commandId on ONE route, written on EVERY outcome including a
 * no-op, inside the same transaction and under the same lock as the authority it describes. Rolled
 * back together with it, so a stored result never describes a change that did not commit.
 *
 * It carries the deployment identity the command ran on, so a replay is attributable to a build even
 * when it produced no transition. Retirement markers and bootstrap attestations write NO row here:
 * they are not commands and are never replayed by a caller.
 */
async function recordCommandResult(
  tx: Prisma.TransactionClient,
  cmd: LaunchGateCommand,
  snapshot: ControlPlaneSnapshotInput,
  payloadFingerprint: string,
  outcome: { resultKind: 'NOOP' | 'APPLIED' | 'ACCEPTED'; state: LaunchGateState; generation: number; lastSeq: number },
): Promise<void> {
  await tx.featureLaunchCommandResult.create({
    data: {
      gateKey: cmd.gateKey,
      routeKey: cmd.routeKey,
      commandId: cmd.commandId,
      resultKind: outcome.resultKind,
      action: cmd.action,
      state: outcome.state,
      generation: outcome.generation,
      lastSeq: outcome.lastSeq,
      payloadFingerprint,
      actorUserId: cmd.actorUserId,
      targetEnvironment: snapshot.targetEnvironment,
      buildReleaseId: snapshot.buildReleaseId,
    },
  });
}

/** Key reuse with another payload or action is a conflict, never a replay (spec:53). */
function assertSameCommand(
  commandId: string,
  stored: { payloadFingerprint: string; action: string },
  payloadFingerprint: string,
  action: LaunchGateAction,
): void {
  if (stored.payloadFingerprint !== payloadFingerprint || stored.action !== action) {
    throw new ConflictException({
      code: 'launch_gate_command_conflict',
      message: `commandId "${commandId}" was already used with a different payload or action.`,
      commandId,
    });
  }
}

/** A caller-stated deployment value is an expectation, CASed against server truth (P0-3a). */
function expectServerValue(field: string, expected: string | null | undefined, actual: string): void {
  if (expected != null && expected !== actual) {
    throw new ConflictException({
      code: 'launch_gate_deployment_mismatch',
      message: `This command expected ${field} "${expected}", but this deployment is "${actual}".`,
      field,
      expected,
      current: actual,
    });
  }
}

/** An authority id is never a caller string: it is either omitted or exactly the actor (P0-3b/c). */
function expectActor(field: string, supplied: string | null | undefined, actorUserId: string): void {
  if (supplied != null && supplied !== actorUserId) {
    throw new UnprocessableEntityException({
      code: 'launch_gate_authority_mismatch',
      message: `${field} is always the authenticated actor and cannot be supplied for another user.`,
      field,
    });
  }
}
