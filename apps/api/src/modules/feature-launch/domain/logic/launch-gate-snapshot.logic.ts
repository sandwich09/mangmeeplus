/**
 * Control-plane snapshot requiredness (spec:54). One transition table serves three shapes, so
 * requiredness is enforced here, by the command, and never by column nullability:
 *
 *  - normal OPEN     → targetEnvironment, buildReleaseId, expectedGeneration,
 *                      emergencyClose=false, releaseApprovedByUserId
 *  - SPECIALIST_LEGAL OPEN → the above PLUS validationEvidenceRef, validationEvidenceHash,
 *                      specialistApprovedByUserId
 *  - normal CLOSE    → environment/build/expected generation + the release authority
 *                      (ordinary command policy)
 *  - emergency CLOSE → emergencyClose=true, emergencyAuthorityUserId, incidentRef; forbids OPEN;
 *                      may omit release/specialist approval so shutdown is never delayed
 *
 * No required field may be reconstructed later from logs or `reason`.
 */
import { createHash } from 'node:crypto';
import type { LaunchRouteClass } from '../launch-matrix.catalog';

export type LaunchGateAction = 'OPEN' | 'CLOSE';

/**
 * What a CALLER may send (P0-3). `targetEnvironment`, `buildReleaseId` and the three approver ids
 * are EXPECTED values only: the command CASes them against server truth and rejects a mismatch, or
 * fills them in when omitted. A caller can therefore state what it believes it is deploying to and
 * be told it is wrong — it can never establish the environment, the build or its own authority.
 */
export type ControlPlaneSnapshotRequest = {
  targetEnvironment?: string | null;
  buildReleaseId?: string | null;
  expectedGeneration: number;
  validationEvidenceRef?: string | null;
  validationEvidenceHash?: string | null;
  specialistApprovedByUserId?: string | null;
  releaseApprovedByUserId?: string | null;
  emergencyClose?: boolean;
  emergencyAuthorityUserId?: string | null;
  incidentRef?: string | null;
};

/** What the SERVER validates and persists: environment/build resolved, authority = the actor. */
export type ControlPlaneSnapshotInput = ControlPlaneSnapshotRequest & {
  targetEnvironment: string;
  buildReleaseId: string;
};

function missing(value: string | null | undefined): boolean {
  return typeof value !== 'string' || value.trim().length === 0;
}

/**
 * Every violated requiredness rule for this (action, routeClass, shape), in a stable order.
 * Empty array = the snapshot satisfies spec:54.
 */
export function launchGateSnapshotViolations(
  action: LaunchGateAction,
  routeClass: LaunchRouteClass,
  snapshot: ControlPlaneSnapshotInput,
): string[] {
  const violations: string[] = [];
  const emergency = snapshot.emergencyClose === true;

  // Common to every shape, emergency included: the transition must always be attributable to an
  // environment, an immutable build and the exact generation it was approved against.
  if (missing(snapshot.targetEnvironment)) violations.push('targetEnvironment is required.');
  if (missing(snapshot.buildReleaseId)) violations.push('buildReleaseId is required.');
  if (!Number.isInteger(snapshot.expectedGeneration) || snapshot.expectedGeneration < 0) {
    violations.push('expectedGeneration must be a non-negative integer.');
  }

  if (emergency) {
    // An emergency snapshot is a shutdown authority, never an opening one.
    if (action === 'OPEN') violations.push('emergencyClose=true forbids an OPEN command.');
    if (missing(snapshot.emergencyAuthorityUserId)) {
      violations.push('emergencyAuthorityUserId is required when emergencyClose=true.');
    }
    if (missing(snapshot.incidentRef)) violations.push('incidentRef is required when emergencyClose=true.');
    return violations;
  }

  // Ordinary command policy — both directions carry the release authority.
  if (missing(snapshot.releaseApprovedByUserId)) {
    violations.push('releaseApprovedByUserId is required for a non-emergency command.');
  }
  if (snapshot.emergencyAuthorityUserId != null || snapshot.incidentRef != null) {
    violations.push('emergencyAuthorityUserId/incidentRef are only valid when emergencyClose=true.');
  }

  // F1.5.1: these three are SHAPE rules only — `missing()` accepts any non-empty string, so a
  // caller could type an evidence ref and hash nobody can resolve or verify. They are NOT the
  // enforcement point, and today they are unreachable from the command: `LaunchGateCommandUseCase`
  // hard-rejects every SPECIALIST_LEGAL OPEN before validation runs. Kept because F1.6 needs them
  // once a persisted approval record can bind ref/hash/approver to something real.
  if (action === 'OPEN' && routeClass === 'SPECIALIST_LEGAL') {
    if (missing(snapshot.validationEvidenceRef)) {
      violations.push('validationEvidenceRef is required to OPEN a SPECIALIST_LEGAL route.');
    }
    if (missing(snapshot.validationEvidenceHash)) {
      violations.push('validationEvidenceHash is required to OPEN a SPECIALIST_LEGAL route.');
    }
    if (missing(snapshot.specialistApprovedByUserId)) {
      violations.push('specialistApprovedByUserId is required to OPEN a SPECIALIST_LEGAL route.');
    }
  }

  return violations;
}

/**
 * Whole-command fingerprint (spec:53). Field order is fixed rather than derived from the object so
 * a caller that reorders its JSON still replays instead of being rejected as key reuse.
 */
export function launchGatePayloadFingerprint(
  action: LaunchGateAction,
  snapshot: ControlPlaneSnapshotInput,
): string {
  const canonical = {
    action,
    targetEnvironment: snapshot.targetEnvironment,
    buildReleaseId: snapshot.buildReleaseId,
    expectedGeneration: snapshot.expectedGeneration,
    validationEvidenceRef: snapshot.validationEvidenceRef ?? null,
    validationEvidenceHash: snapshot.validationEvidenceHash ?? null,
    specialistApprovedByUserId: snapshot.specialistApprovedByUserId ?? null,
    releaseApprovedByUserId: snapshot.releaseApprovedByUserId ?? null,
    emergencyClose: snapshot.emergencyClose === true,
    emergencyAuthorityUserId: snapshot.emergencyAuthorityUserId ?? null,
    incidentRef: snapshot.incidentRef ?? null,
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}
