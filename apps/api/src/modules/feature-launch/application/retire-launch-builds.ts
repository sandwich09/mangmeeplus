/**
 * POST-DEPLOY launch-build retirement (UAT r5 items 1 + 6).
 *
 * Retirement used to happen INSIDE the two writers of an OPEN row — the deploy bootstrap's per-build
 * attestation and the command's acceptance path — which ran in the PRE-deploy release task. That is
 * the wrong moment twice over: the release task attests the incoming build and retires the outgoing
 * one BEFORE a single task of the new build is serving, so a rollout that never becomes healthy has
 * already destroyed the authority of the build still taking traffic; and the writers guessed the
 * window from the last two transitions rather than from what is actually RUNNING.
 *
 * So the pre-deploy release task now only APPENDS acceptance of the new build, and this pass runs
 * AFTER service health verification with an EXPLICIT list of the builds currently serving:
 *
 *   accept (release task) → deploy → health → verify actives (AWS) → retire (this pass)
 *
 * The active list is authority, not a hint. Everything attested that is NOT in it loses authority;
 * everything in it must already be attested. Nothing is inferred from transition recency.
 *
 * UAT r6 item 4b — that also covers the rollout that FAILED. The pre-deploy release task attests the
 * incoming build before a single task of it is serving, so a rollout that never converges (or is
 * rolled back) leaves a build attested that nothing ever ran. Running the pass in `reconcile` mode
 * against the post-rollback active list is what takes that authority back: the incoming build is
 * simply "attested and not active", the same shape as a superseded one. The deployed commit is
 * deliberately NOT required to be in the active list — after a rollback it is precisely the commit
 * that is not.
 *
 * ITEM 6 — no exemption for human approvals. A build a PERSON approved is bounded by exactly the
 * same rule as one a deploy attested: once it stops running, its authority is retired. What differs
 * is the way back: SYSTEM lineage is re-attested by the next verified deployment (`seedLaunchGates`,
 * `:s<seq>` command ids), while human/specialist lineage requires a FRESH human command — never an
 * automatic re-attestation, and never a replay of an old one (`FeatureLaunchCommandResult`).
 *
 * Nothing is ever deleted or rewritten: a retirement is an append-only `CLOSE` marker, and
 * `liveAttestationKeys` reads the NEWEST marker per build, so approval history stays immutable and a
 * rolled-back build is re-attested at a higher seq rather than bricked.
 */
import type { DeploymentIdentity } from '@watchdog-bms/config';
import type { PrismaService } from '../../../common/database/prisma.service';
import { exclusiveLaunchGateLock } from './execution-attempt.service';
import { attestationKey, liveAttestationKeys } from './launch-gate.guard';
import { LAUNCH_GATE_SYSTEM_ACTOR } from './use-cases/launch-gate-command.use-case';

/**
 * How many builds may hold authority on ONE generation at once: `{current, previous}`. Rolling-safe
 * — the outgoing and incoming tasks are both serving during a rollout — and bounded, so an
 * attestation is never a permanent allowlist. An active list LONGER than this is not a bigger
 * window, it is a signal that the deployment never converged, and this pass halts instead of
 * blessing it. See `LaunchGateGuardService.assertLaunchRouteOpen` for the full rationale.
 */
export const LAUNCH_ATTESTATION_WINDOW = 2;

/** commandId/fingerprint prefix of a retirement marker, so it is greppable and never a real command. */
export const LAUNCH_ATTESTATION_RETIRE_PREFIX = 'F1-RETIRE';

/**
 * `retire` is the healthy path: the rollout converged, was health-verified, and the builds it
 * superseded lose authority. `reconcile` is the SAME pass after a rollout that failed or rolled back
 * (UAT r6 item 4b) — the release task had already pre-attested the incoming build, that build never
 * served a request, and leaving it attested would let a failed build keep launch-gate authority
 * indefinitely. The rules do not change between the two; only the recorded reason does, so the
 * append-only ledger says which of the two moments took the authority away.
 */
export type RetireLaunchBuildsMode = 'retire' | 'reconcile';

const RETIRE_REASON: Record<RetireLaunchBuildsMode, string> = {
  retire: 'post-deploy retirement: not among the builds serving after health verification',
  reconcile: 'post-rollback reconciliation: attested but not among the builds serving now',
};

/** One route, as the read-only survey saw it. */
type SurveyedRoute = {
  gateKey: string;
  routeKey: string;
  generation: number;
  /** The generation's OPEN lineage is SYSTEM + ORDINARY — the set a deploy is expected to attest. */
  systemLineage: boolean;
  /** Builds whose NEWEST marker is an OPEN: the authority actually in force right now. */
  liveBuilds: string[];
  routeClass: string;
};

export type RetireLaunchBuildsResult = {
  surveyed: number;
  retired: Array<{ gateKey: string; routeKey: string; generation: number; buildReleaseId: string; seq: number }>;
  skipped: Array<{ gateKey: string; routeKey: string; reason: string }>;
};

export type RetireLaunchBuildsOptions = {
  /** The builds serving RIGHT NOW, read from the deployment platform after health verification. */
  activeBuilds: readonly string[];
  deployment: DeploymentIdentity;
  requestId: string;
  /** Exact ECS deployment observed before deriving active builds; never a later `currentDeployment`. */
  deploymentArn: string;
  /** Which moment is taking the authority away; defaults to the healthy post-deploy path. */
  mode?: RetireLaunchBuildsMode;
  log?: (message: string) => void;
};

export type RetireExactFailedBuildOptions = {
  buildReleaseId: string;
  deployment: DeploymentIdentity;
  deploymentArn: string | null;
  mutationIntentId: string;
  requestId: string;
  log?: (message: string) => void;
};

/** A halt is a refusal to act on an active list that cannot be trusted — never a partial retirement. */
export class LaunchRetirementHalt extends Error {
  constructor(readonly reasons: readonly string[]) {
    super(`launch-build retirement HALTED — nothing was retired:\n${reasons.map((r) => `  - ${r}`).join('\n')}`);
    this.name = 'LaunchRetirementHalt';
  }
}

export async function retireLaunchBuilds(
  prisma: PrismaService,
  options: RetireLaunchBuildsOptions,
): Promise<RetireLaunchBuildsResult> {
  const log = options.log ?? (() => {});
  const mode = options.mode ?? 'retire';
  const active = new Set(options.activeBuilds.map((build) => build.trim()).filter((build) => build !== ''));
  const environment = options.deployment.targetEnvironment;

  // ── Phase 1: read-only survey ───────────────────────────────────────────────
  // Every halt is collected before ANYTHING is written. A wrong active list is the one failure that
  // can brick the platform (retire every build on every route), so the pass is all-or-nothing: it
  // never retires "the routes that looked fine" while another route says the list is wrong.
  const halts: string[] = [];
  if (active.size === 0) halts.push('--active-builds is empty; refusing to retire every attested build');
  if (active.size > LAUNCH_ATTESTATION_WINDOW) {
    halts.push(
      `${active.size} builds are serving at once (${[...active].join(', ')}), above the ${LAUNCH_ATTESTATION_WINDOW}-build `
      + 'window; the rollout has not converged — re-run once one build remains',
    );
  }
  // UAT r7 item 1(c) — `retire` asserts "the incoming build IS one of the builds serving now". An
  // active list that omits it is not a post-deploy retirement: it would take authority away from
  // every build EXCEPT the one that never served — including whatever is actually taking traffic.
  // `run-release-task.sh` refuses the same shape before the task starts, but the authority to retire
  // lives in this pass, so the rule lives here too and is enforced against the deployment identity
  // rather than a caller-supplied argument. `reconcile` stays deliberately exempt: after a rollback
  // the deployed commit is precisely the one NOT serving, which is why that mode exists.
  if (mode === 'retire' && !active.has(options.deployment.buildReleaseId)) {
    halts.push(
      `retire requires the incoming build ${options.deployment.buildReleaseId} to be serving `
      + `(active=${[...active].join(', ') || 'none'}) — use reconcile`,
    );
  }

  const gates = await prisma.client.featureLaunchGate.findMany({
    where: { state: 'OPEN' },
    select: { gateKey: true, routeKey: true, generation: true },
    orderBy: [{ gateKey: 'asc' }, { routeKey: 'asc' }],
  });
  if (gates.length === 0) {
    halts.push('no OPEN launch-gate rows exist; seeded catalog authority cannot be corroborated');
  }

  const surveyed: SurveyedRoute[] = [];
  for (const gate of gates) {
    const route = await surveyRoute(prisma.client, gate, environment, active);
    if (route.liveBuilds.length > 0) surveyed.push(route);
    // A SYSTEM-lineage route is the one the deploy itself just attested on the incoming build. If it
    // does not name an active build, the active list did not come from the deployment this release
    // task ran for — a stale query, the short sha instead of the full commit, another service. That
    // is exactly the "never guess" case, so it halts rather than retiring against a wrong list.
    if (!route.systemLineage) continue;
    for (const build of active) {
      if (route.liveBuilds.includes(build)) continue;
      halts.push(
        `active build ${build} is NOT attested on SYSTEM-opened ${route.gateKey}/${route.routeKey} `
        + `generation ${route.generation} in ${environment}; the release task never accepted it`,
      );
    }
  }
  // Human/specialist routes are deliberately unattested on a new build, so they corroborate nothing.
  // With no SYSTEM-lineage route at all, no route corroborates the active list and it is unverified.
  if (gates.length > 0 && !surveyed.some((route) => route.systemLineage)) {
    halts.push('no SYSTEM-opened route corroborates the active build list; it cannot be verified against this deployment');
  }
  if (halts.length > 0) throw new LaunchRetirementHalt(halts);

  // ── Phase 2: append the markers ─────────────────────────────────────────────
  const result: RetireLaunchBuildsResult = { surveyed: surveyed.length, retired: [], skipped: [] };
  for (const route of surveyed) {
    const applied = await applyRoute(
      prisma, route, environment, active, options.requestId, options.deploymentArn, mode,
    );
    if (typeof applied === 'string') result.skipped.push({ gateKey: route.gateKey, routeKey: route.routeKey, reason: applied });
    else result.retired.push(...applied);
  }
  log(
    `launch builds: mode=${mode} active=${[...active].join(',')} routes=${result.surveyed} `
    + `retired=${result.retired.length} skipped=${result.skipped.length}`,
  );
  return result;
}

/**
 * Bootstrap-only rollback cleanup. Exact ECS recovery has already proved that the persisted
 * 12-character legacy descriptor is the sole survivor. That descriptor has no launch attestation
 * to preserve, so this pass closes ONLY the incoming full-SHA marker and never derives authority
 * from, expands, attests or retires the legacy SHA.
 */
export async function retireExactFailedBuild(
  prisma: PrismaService,
  options: RetireExactFailedBuildOptions,
): Promise<RetireLaunchBuildsResult> {
  if (!/^[0-9a-f]{40}$/.test(options.buildReleaseId)) {
    throw new LaunchRetirementHalt(['exact failed build must be one full lowercase commit SHA']);
  }
  const gates = await prisma.client.featureLaunchGate.findMany({
    where: { state: 'OPEN' },
    select: { gateKey: true, routeKey: true, generation: true },
    orderBy: [{ gateKey: 'asc' }, { routeKey: 'asc' }],
  });
  if (gates.length === 0) throw new LaunchRetirementHalt(['no OPEN launch-gate rows exist']);
  const result: RetireLaunchBuildsResult = { surveyed: gates.length, retired: [], skipped: [] };
  for (const route of gates) {
    const applied = await prisma.client.$transaction(async (tx) => {
      await tx.$executeRaw(exclusiveLaunchGateLock(route.gateKey, route.routeKey));
      const gate = await tx.featureLaunchGate.findUnique({
        where: { gateKey_routeKey: { gateKey: route.gateKey, routeKey: route.routeKey } },
        select: { state: true, generation: true, lastSeq: true },
      });
      if (gate?.state !== 'OPEN' || gate.generation !== route.generation) return null;
      const rows = await tx.featureLaunchGateTransition.findMany({
        where: routeMarkersWhere(route, options.deployment.targetEnvironment),
        select: { gateKey: true, routeKey: true, buildReleaseId: true, action: true, seq: true, routeClass: true },
      });
      const live = liveAttestationKeys(rows);
      if (!live.has(attestationKey({ ...route, buildReleaseId: options.buildReleaseId }))) return null;
      const seq = gate.lastSeq + 1;
      const commandId = `${LAUNCH_ATTESTATION_RETIRE_PREFIX}:${options.deployment.targetEnvironment}:${options.buildReleaseId}:g${route.generation}:s${seq}`;
      await tx.featureLaunchGateTransition.create({
        data: {
          gateKey: route.gateKey,
          routeKey: route.routeKey,
          seq,
          generation: route.generation,
          commandId,
          action: 'CLOSE',
          actorUserId: LAUNCH_GATE_SYSTEM_ACTOR,
          payloadFingerprint: commandId,
          reason: 'exact bootstrap rollback: incoming full-SHA build never became the serving singleton',
          targetEnvironment: options.deployment.targetEnvironment,
          buildReleaseId: options.buildReleaseId,
          expectedGeneration: route.generation,
          routeClass: rows.find((row) => row.action === 'OPEN')?.routeClass ?? 'ORDINARY',
          releaseApprovedByUserId: LAUNCH_GATE_SYSTEM_ACTOR,
          emergencyClose: false,
        },
      });
      await tx.featureLaunchGate.update({
        where: { gateKey_routeKey: { gateKey: route.gateKey, routeKey: route.routeKey } },
        data: { lastSeq: seq },
      });
      await tx.auditLog.create({
        data: {
          actorType: 'SYSTEM',
          action: 'system.launch_gate.retire_failed_bootstrap_build',
          targetType: 'launch_gate',
          targetId: `${route.gateKey}:${route.routeKey}`,
          requestId: options.requestId,
          result: 'SUCCESS',
          riskLevel: 'CRITICAL',
          metadataJson: {
            commandId,
            seq,
            generation: route.generation,
            targetEnvironment: options.deployment.targetEnvironment,
            buildReleaseId: options.buildReleaseId,
            deploymentArn: options.deploymentArn,
            mutationIntentId: options.mutationIntentId,
            legacyBuildAction: 'UNTOUCHED',
          },
        },
      });
      return { gateKey: route.gateKey, routeKey: route.routeKey, generation: route.generation, buildReleaseId: options.buildReleaseId, seq };
    });
    if (applied) result.retired.push(applied);
    else result.skipped.push({ gateKey: route.gateKey, routeKey: route.routeKey, reason: 'exact failed build is already non-live or route moved' });
  }
  options.log?.(`exact failed build cleanup: build=${options.buildReleaseId} retired=${result.retired.length} skipped=${result.skipped.length}`);
  return result;
}

/** The read-only half: what authority this route holds, and whose approval created it. */
async function surveyRoute(
  db: PrismaService['client'],
  gate: { gateKey: string; routeKey: string; generation: number },
  environment: string,
  active: ReadonlySet<string>,
): Promise<SurveyedRoute> {
  const rows = await db.featureLaunchGateTransition.findMany({
    where: routeMarkersWhere(gate, environment),
    select: { gateKey: true, routeKey: true, buildReleaseId: true, action: true, seq: true, actorUserId: true, routeClass: true },
    orderBy: { seq: 'asc' },
  });
  const live = liveAttestationKeys(rows);
  const liveBuilds = [...new Set(rows.filter((row) => live.has(attestationKey(row))).map((row) => row.buildReleaseId))];
  // The lineage of a generation is the OPEN that CREATED it — attestations and acceptances never
  // create one — so it is the FIRST OPEN at this generation, exactly as `attestOpenOnThisBuild` reads it.
  const lineage = rows.find((row) => row.action === 'OPEN');
  return {
    gateKey: gate.gateKey,
    routeKey: gate.routeKey,
    generation: gate.generation,
    systemLineage: lineage?.actorUserId === LAUNCH_GATE_SYSTEM_ACTOR && lineage?.routeClass === 'ORDINARY',
    liveBuilds,
    routeClass: lineage?.routeClass ?? 'ORDINARY',
  };
}

/**
 * Appends this route's retirement markers under the SAME exclusive route lock every other transition
 * takes, and re-derives the decision inside it: the survey ran unlocked, so an operator CLOSE, a
 * rollback re-attestation or a concurrent pass may have moved the route since. A stale plan skips
 * the route rather than retiring a build that has just been re-approved.
 */
async function applyRoute(
  prisma: PrismaService,
  route: SurveyedRoute,
  environment: string,
  active: ReadonlySet<string>,
  requestId: string,
  deploymentArn: string,
  mode: RetireLaunchBuildsMode,
): Promise<RetireLaunchBuildsResult['retired'] | string> {
  return prisma.client.$transaction(async (tx) => {
    await tx.$executeRaw(exclusiveLaunchGateLock(route.gateKey, route.routeKey));
    const gate = await tx.featureLaunchGate.findUnique({
      where: { gateKey_routeKey: { gateKey: route.gateKey, routeKey: route.routeKey } },
      select: { state: true, generation: true, lastSeq: true },
    });
    if (gate?.state !== 'OPEN') return 'the route was CLOSED between the survey and the lock — its whole generation is already dead';
    if (gate.generation !== route.generation) return 'the generation moved between the survey and the lock; nothing on the surveyed one still holds authority';

    const rows = await tx.featureLaunchGateTransition.findMany({
      where: routeMarkersWhere(route, environment),
      select: { gateKey: true, routeKey: true, buildReleaseId: true, action: true, seq: true },
    });
    const live = liveAttestationKeys(rows);
    const liveBuilds = [...new Set(rows
      .filter((row) => live.has(attestationKey(row)))
      .map((row) => row.buildReleaseId))];
    const retireNow = liveBuilds.filter((build) => !active.has(build));

    const retired: RetireLaunchBuildsResult['retired'] = [];
    let seq = gate.lastSeq + 1;
    for (const buildReleaseId of retireNow) {
      // Re-checked under the lock: an active build is never retired, and an already-retired build is
      // never retired twice (its newest marker is no longer an OPEN).
      if (active.has(buildReleaseId)) continue;
      if (!live.has(attestationKey({ gateKey: route.gateKey, routeKey: route.routeKey, buildReleaseId }))) continue;
      // `seq` is unique per route, so it alone makes the key unique — a build may be attested,
      // retired and re-attested on one generation over its lifetime.
      const commandId = `${LAUNCH_ATTESTATION_RETIRE_PREFIX}:${environment}:${buildReleaseId}:g${route.generation}:s${seq}`;
      await tx.featureLaunchGateTransition.create({
        data: {
          gateKey: route.gateKey,
          routeKey: route.routeKey,
          seq,
          generation: route.generation,
          commandId,
          action: 'CLOSE',
          actorUserId: LAUNCH_GATE_SYSTEM_ACTOR,
          payloadFingerprint: commandId,
          reason: RETIRE_REASON[mode],
          targetEnvironment: environment,
          buildReleaseId,
          expectedGeneration: route.generation,
          routeClass: route.routeClass as 'ORDINARY' | 'SPECIALIST_LEGAL',
          releaseApprovedByUserId: LAUNCH_GATE_SYSTEM_ACTOR,
          emergencyClose: false,
        },
      });
      // This pass is an out-of-band privileged action (an operator can run it with any active list),
      // unlike the old retirement that was a side effect of a command that audited itself.
      await tx.auditLog.create({
        data: {
          actorType: 'SYSTEM',
          action: 'system.launch_gate.retire_build',
          targetType: 'launch_gate',
          targetId: `${route.gateKey}:${route.routeKey}`,
          requestId,
          result: 'SUCCESS',
          riskLevel: 'HIGH',
          metadataJson: {
            commandId,
            mode,
            seq,
            generation: route.generation,
            targetEnvironment: environment,
            buildReleaseId,
            activeBuilds: [...active],
            deploymentArn,
            systemLineage: route.systemLineage,
          },
        },
      });
      retired.push({ gateKey: route.gateKey, routeKey: route.routeKey, generation: route.generation, buildReleaseId, seq });
      seq += 1;
    }
    if (retired.length > 0) {
      await tx.featureLaunchGate.update({
        where: { gateKey_routeKey: { gateKey: route.gateKey, routeKey: route.routeKey } },
        data: { lastSeq: seq - 1 },
      });
    }
    return retired;
  });
}

/**
 * The guard's admission predicate minus the build: every marker of this route+generation+environment.
 * Scoped to `targetEnvironment` so a UAT pass can never retire a production build, or the reverse.
 */
const routeMarkersWhere = (route: { gateKey: string; routeKey: string; generation: number }, targetEnvironment: string) => ({
  gateKey: route.gateKey,
  routeKey: route.routeKey,
  generation: route.generation,
  targetEnvironment,
});
