/**
 * The designated "entitled, but its launch route is closed right now" guard (spec:53, spec:65).
 *
 * F1.3 only exports it; the consumers (root mutations, queued work, outbound dispatch) arrive in
 * F1.4 together with the availability-vector stamping. The read is deliberately UNCACHED: spec:60
 * — a cached read is not a fence, so a concurrent CLOSE must be observable by the next attempt.
 *
 * An absent gate row is treated as CLOSED, matching the schema default: a route that the bootstrap
 * has never materialized has never been opened.
 */
import { Injectable } from '@nestjs/common';
import { resolveDeploymentIdentity } from '@watchdog-bms/config';
import { PrismaService } from '../../../common/database/prisma.service';
import { featureTemporarilyUnavailable } from '../../employee-access/application/entitlement.helper';

/**
 * The ONE admission predicate of the launch control plane (F1.5.2): every transition recorded for
 * the row's CURRENT generation, naming THIS environment and THIS build.
 *
 * Shared verbatim by the guard (does this runtime pass?), the command (is this OPEN already
 * satisfied, or is it a per-build acceptance?), the bootstrap (is this build already attested?) and
 * `ExecutionAttempt` (was the stamped build — and the running one — authorized?), so the four can
 * never drift apart on what "open here" means.
 *
 * `generation` is what makes it a fence rather than a label: a CLOSE increments it, and every
 * attestation of every build then belongs to a dead generation at once.
 *
 * It deliberately does NOT filter on `action`: a build's authority is decided by its NEWEST marker,
 * and a RETIREMENT marker is what takes it away (see `liveAttestationKeys`).
 */
export function attestationOnDeploymentWhere(
  gateKey: string,
  routeKey: string,
  generation: number,
  deployment: { targetEnvironment: string; buildReleaseId: string },
) {
  return {
    gateKey,
    routeKey,
    generation,
    targetEnvironment: deployment.targetEnvironment,
    buildReleaseId: deployment.buildReleaseId,
  };
}

/** One append-only marker of a (route, generation, environment, build), as the authority rule reads it. */
export type AttestationMarker = {
  gateKey: string;
  routeKey: string;
  buildReleaseId: string;
  action: string;
  seq: number;
};

/** The authority-rule key: authority is per ROUTE and per BUILD, never per gate row alone. */
export const attestationKey = (row: { gateKey: string; routeKey: string; buildReleaseId: string }): string =>
  `${row.gateKey} ${row.routeKey} ${row.buildReleaseId}`;

/**
 * THE AUTHORITY RULE (F1.5.2 owner ruling 1). Given every marker of one generation and environment,
 * returns the `attestationKey`s whose NEWEST marker is an OPEN — i.e. the builds still authorized.
 *
 * An attestation is therefore not a permanent allowlist: a later RETIREMENT marker (an append-only
 * `CLOSE` row naming the same route, generation, environment and build) supersedes it, and a fresh
 * OPEN at a higher seq revives it. Newest-wins is what makes both directions expressible in an
 * append-only table, and what lets a rolled-back build be re-attested rather than bricked.
 *
 * A `CLOSE` row can only mean "retired" here because the caller has already established that the
 * gate row is OPEN at this generation: a real CLOSE creates the NEXT generation, so no real CLOSE
 * can exist at the generation the row is currently open on.
 */
export function liveAttestationKeys(rows: readonly AttestationMarker[]): Set<string> {
  const newest = new Map<string, AttestationMarker>();
  for (const row of rows) {
    const key = attestationKey(row);
    const seen = newest.get(key);
    if (!seen || row.seq > seen.seq) newest.set(key, row);
  }
  return new Set([...newest].filter(([, row]) => row.action === 'OPEN').map(([key]) => key));
}

/** The single-route form of the authority rule: is THIS build still open on THIS route+generation? */
export async function isOpenOnDeployment(
  db: { featureLaunchGateTransition: { findMany: (args: any) => Promise<AttestationMarker[]> } },
  gateKey: string,
  routeKey: string,
  generation: number,
  deployment: { targetEnvironment: string; buildReleaseId: string },
): Promise<boolean> {
  const rows = await db.featureLaunchGateTransition.findMany({
    where: attestationOnDeploymentWhere(gateKey, routeKey, generation, deployment),
    select: { gateKey: true, routeKey: true, buildReleaseId: true, action: true, seq: true },
  });
  return liveAttestationKeys(rows).size > 0;
}

@Injectable()
export class LaunchGateGuardService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Throws `feature_temporarily_unavailable` (403) unless this exact route is OPEN **on this
   * deployment**.
   *
   * F1.5.1 item 4 — `state = OPEN` alone is not authorization. An OPEN carries the environment and
   * build it was approved against, so the guard re-checks both against the running deployment:
   * an approval granted on build A, or in uat, never authorizes build B or production. A mismatch
   * reads as CLOSED (`feature_temporarily_unavailable`), never as a different error class — the
   * caller's answer is the same either way, and the reason is control-plane detail.
   *
   * F1.5.2 — it asks for ANY LIVE OPEN of the CURRENT generation naming this deployment, not for
   * the LATEST one. A rolling deploy runs builds A and B at the same time and the release task
   * attests B before the last A task is drained, so "latest wins" would refuse every live A task the
   * moment B is attested. Several SYSTEM attestations may therefore coexist inside one generation,
   * one per build in the rolling window, and each admits only its own runtime.
   *
   * TWO-BUILD WINDOW (owner ruling 1, re-timed by UAT r5 item 1). An attestation is NOT a permanent
   * allowlist. The window is bounded at {current, previous} per generation — but bounding it is a
   * POST-DEPLOY pass (`retireLaunchBuilds`), never a write path. Nothing that appends an OPEN can see
   * which builds are actually serving, so retiring from there was a guess made at the worst moment:
   * the pre-deploy release task revoked the outgoing build before the incoming one had proven
   * healthy. Retirement now runs after health verification against the EXPLICIT list of serving
   * builds, retires every attested build not in it, and halts rather than act on a list it cannot
   * corroborate. Two is the smallest window a rolling deploy can survive — the outgoing and incoming
   * tasks are both serving during the rollout — and the smallest that keeps authority bounded, so a
   * build from three releases ago cannot still be admitted by a row nobody has re-approved since. The
   * deliberate consequence: a task that outlives its build's presence in the deployment is refused
   * rather than silently authorized, and its queued work terminalizes under its matrix treatment
   * instead of dispatching under stale authority. A retired build that is later rolled back to is
   * re-attested by the next bootstrap (newest marker wins), never permanently bricked — and item 6:
   * that re-attestation is for SYSTEM lineage only; a retired HUMAN approval needs a fresh command.
   *
   * The generation keeps the window from becoming a leak: a CLOSE increments it, so every
   * attestation of every build in the window dies in the same instant. A human OPEN naming a build
   * this generation has not accepted is a per-build ACCEPTANCE at the SAME generation (owner ruling
   * 2, `LaunchGateCommandUseCase`) — it admits the new build without orphaning work already stamped
   * on the accepted ones, and the same two-build window bounds it.
   *
   * Consequence, deliberate: a HUMAN-opened route goes unavailable on the next deploy until a
   * human re-OPENs it on the new build. Only rows whose OPEN lineage is SYSTEM-seeded are carried
   * across builds, by the idempotent per-build attestation the bootstrap appends
   * (`seedLaunchGates`) — a deploy may re-attest what a deploy itself opened, never what a person
   * approved.
   */
  async assertLaunchRouteOpen(gateKey: string, routeKey = 'DEFAULT'): Promise<void> {
    const gate = await this.prisma.client.featureLaunchGate.findUnique({
      where: { gateKey_routeKey: { gateKey, routeKey } },
      select: { state: true, generation: true },
    });
    if (gate?.state !== 'OPEN') throw featureTemporarilyUnavailable(gateKey);

    const admits = await isOpenOnDeployment(
      this.prisma.client,
      gateKey,
      routeKey,
      gate.generation,
      resolveDeploymentIdentity(process.env),
    );
    // Includes the no-transition case: an OPEN row with no recorded OPEN was never approved.
    if (!admits) throw featureTemporarilyUnavailable(gateKey);
  }
}
