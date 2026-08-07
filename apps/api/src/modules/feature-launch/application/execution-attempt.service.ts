/**
 * CC1 `ExecutionAttempt` service (spec:59-64): availability-vector stamping, the linearized
 * QUEUED→CLAIMED claim, and the durable `DISPATCHING` token/lease seam.
 *
 * PER-ATTEMPT ONLY. No batch API is exported and none may be added here: spec:61 forbids a batch
 * claim until F0 capacity evidence passes the UAT rerun, and `docs/agent-memory/f0-capacity-
 * evidence.md` §7.2 item 1 makes per-attempt the default. A bounded batch would additionally have
 * to persist an individual claim + dispatch token per item inside one linearized transaction and
 * carry one identical `availabilityVectorHash` for one company — that is why the hash exists here.
 *
 * F1 SCOPE: nothing on a hot path calls `claimAttempt` yet. Enforcement is NOT flipped (plan §3 F1
 * "reads/stamps in shadow … then atomically flip enforcement"); the shadow surfaces observe and
 * record only. This service is the seam that flip will consume.
 */
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { requiredFeatureKeys } from '@watchdog-bms/contracts';
import { Prisma, type ExecutionAttemptStatus } from '../../../generated/prisma/client';
import { AppConfigService } from '../../../common/config/app-config.service';
import { PrismaService } from '../../../common/database/prisma.service';
import { LOGGER_TOKEN, type AppLogger } from '../../../common/logger/logger.service';
// The ONE authority rule of the control plane, shared with the guard, the command and the bootstrap.
import { attestationKey, liveAttestationKeys } from './launch-gate.guard';

export type LaunchRouteRef = { gateKey: string; routeKey?: string };
export type StampedLaunchEntry = { gateKey: string; routeKey: string; generation: number };
/** `null` = the company had no entitlement row for that key when the work was stamped. */
export type StampedEpochs = Record<string, number | null>;

/**
 * Which of the four close-time terminals this row's `FEATURE_LAUNCH_MATRIX` treatment uses
 * (spec:64-66). SUPPRESS drops the work; SKIP retains it as evidence and may be offered for
 * *manual* replay later. Neither ever replays automatically. SUPPRESS is the default because it is
 * the safe half: work that is silently dropped is recoverable by Resume/Reissue, work that is
 * quietly replayable is not.
 *
 * It is an argument rather than a column because F1.1's schema is committed and F1.3's catalog does
 * not yet carry a per-route treatment; the durable home is a `FEATURE_LAUNCH_MATRIX` column.
 */
export type TerminalTreatment = 'SUPPRESS' | 'SKIP';

export type CreateStampedAttemptInput = {
  /** null mirrors `OutboxEvent.companyId` for platform-level work; only gates apply then. */
  companyId: string | null;
  sourceType: string;
  sourceId: string;
  /** Caller-stable idempotency key. Reuse an existing repo anchor (outbox `eventKey`, campaign `retryKey`, …). */
  attemptKey: string;
  /** Resume/Reissue mints the next seq (spec:64); it never revives the old row. */
  attemptSeq?: number;
  /** The OWNING feature key(s). Declared dependencies are expanded automatically (spec:59). */
  featureKeys: readonly string[];
  routes: readonly LaunchRouteRef[];
  retainedArtifactPolicy?: string | null;
};

export type StampedAttempt = {
  id: string;
  status: string;
  entitlementEpochs: StampedEpochs;
  launchEntries: StampedLaunchEntry[];
  availabilityVectorHash: string;
};

export type ClaimOutcome = {
  claimed: boolean;
  status: string;
  reason?: string;
};

/**
 * Proof that the holder still owns the DISPATCHING lease it was granted. Required by every write
 * that happens after the token is minted: `leaseGeneration` is bumped on every (re)acquisition, so
 * a worker whose expired lease was taken over holds a generation that no longer matches the row.
 */
export type DispatchFence = {
  leaseOwner: string;
  leaseGeneration: number;
  /** The provider idempotency key, when the caller carries it. Tightens the CAS further. */
  dispatchToken?: string;
};

/** What a granted lease hands back — usable verbatim as the `DispatchFence` for every later write. */
export type DispatchLease = DispatchFence & { dispatchToken: string };

/** The `FOR UPDATE` projection `acquireDispatchLease` decides on, inside the lock. */
type LockedAttemptRow = {
  companyId: string | null;
  status: ExecutionAttemptStatus;
  dispatchToken: string | null;
  dispatchedAt: Date | null;
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
  leaseGeneration: number;
  entitlementEpochsJson: unknown;
  launchEntriesJson: unknown;
  targetEnvironment: string | null;
  buildReleaseId: string | null;
};

/** The deployment half of a stamped vector — which environment/build's approval it was read under. */
type StampedDeployment = { targetEnvironment: string | null; buildReleaseId: string | null };

/** Default DISPATCHING lease. Short: an expired lease before invocation is resumable (plan:40). */
export const DEFAULT_DISPATCH_LEASE_MS = 60_000;

export const sharedEntitlementLock = (companyId: string) =>
  Prisma.sql`SELECT pg_advisory_xact_lock_shared(hashtext(${`entitlement:${companyId}`}))`;
const sharedLaunchGateLock = (gateKey: string, routeKey: string) =>
  Prisma.sql`SELECT pg_advisory_xact_lock_shared(hashtext(${`launch_gate:${gateKey}:${routeKey}`}))`;

/**
 * Serializes two callers stamping the SAME work. `ON CONFLICT` arbitrates on one index only, and
 * this row now carries three unique indexes that a duplicate stamp violates simultaneously
 * (`attemptKey`, `(companyScope, attemptKey)`, `(companyScope, source…, attemptSeq)`); when the
 * loser's speculative insert reaches a NON-arbiter index it raises unique_violation instead of
 * taking the DO UPDATE path. Measured at ~21% of concurrent identical stamps before this lock.
 */
const attemptIdentityLock = (storedKey: string) =>
  Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`execution_attempt:${storedKey}`}))`;

/**
 * Serializes two callers stamping the same WORK under two DIFFERENT caller keys.
 *
 * The key lock cannot: `(companyScope, sourceType, sourceId, attemptSeq)` is a second, independent
 * unique, so two distinct keys naming one source sail past the key lock in parallel and collide on
 * it — surfacing as a raw P2002 rather than an answerable conflict. A pre-read alone is not enough
 * either: without a lock the two reads interleave and both see nothing. Taken FIRST and always
 * before the key lock, so both locks are acquired in one global order and can never form a cycle.
 */
const attemptSourceIdentityLock = (companyScope: string, sourceType: string, sourceId: string, attemptSeq: number) =>
  Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`execution_attempt_source:${companyScope}::${sourceType}::${sourceId}::${attemptSeq}`}))`;

/** The exclusive counterparts, taken by the entitlement and launch-gate commands (spec:60). */
export const exclusiveEntitlementLock = (companyId: string) =>
  Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`entitlement:${companyId}`}))`;
export const exclusiveLaunchGateLock = (gateKey: string, routeKey: string) =>
  Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`launch_gate:${gateKey}:${routeKey}`}))`;

/**
 * Platform-level work has no company row, and Postgres treats NULLs in a unique index as distinct,
 * so the null scope carries an explicit sentinel INSIDE the key (P0-5). Without it a global
 * `attemptKey` lets one caller key resolve to another tenant's attempt.
 */
export const PLATFORM_ATTEMPT_SCOPE = '__platform__';

/** The value of the NOT-NULL `companyScope` column every tenant-scoped unique index is keyed on. */
export function attemptScope(companyId: string | null): string {
  return companyId ?? PLATFORM_ATTEMPT_SCOPE;
}

/**
 * The stored key: tenant-scoped AND sequence-bearing.
 *
 * The sequence segment is load-bearing. Resume/Reissue mints the NEXT seq (spec:64) and must get a
 * NEW row; without the segment the same caller key at `attemptSeq=2` upserts onto attempt #1 and
 * silently resumes the very row the new sequence exists to replace.
 */
export function scopedAttemptKey(companyId: string | null, attemptKey: string, attemptSeq = 1): string {
  return `${attemptScope(companyId)}::${attemptSeq}::${attemptKey}`;
}

/**
 * Version tag on `identityFingerprint`. Rows written before this version hashed a narrower identity
 * (no sequence, no feature/route/policy vector), so their digests are NOT comparable with today's —
 * an untagged value means "legacy", compared structurally instead of being rejected wholesale.
 */
export const IDENTITY_FINGERPRINT_VERSION = 'v2';

/** `(gateKey, routeKey)` in canonical order — the shape both the stamp and the fingerprint use. */
function normalizeRoutes(routes: readonly LaunchRouteRef[]): Array<{ gateKey: string; routeKey: string }> {
  return [...routes]
    .map((route) => ({ gateKey: route.gateKey, routeKey: route.routeKey ?? 'DEFAULT' }))
    .sort((a, b) => a.gateKey.localeCompare(b.gateKey) || a.routeKey.localeCompare(b.routeKey));
}

function sortedStampedEntries(entries: readonly StampedLaunchEntry[]): StampedLaunchEntry[] {
  return [...entries].sort((left, right) => left.gateKey.localeCompare(right.gateKey)
    || left.routeKey.localeCompare(right.routeKey));
}

function sameLockVector(
  left: { companyId: string | null; launchEntriesJson: unknown },
  right: { companyId: string | null; launchEntriesJson: unknown },
): boolean {
  if (left.companyId !== right.companyId) return false;
  const canonical = (value: unknown) => sortedStampedEntries((value ?? []) as StampedLaunchEntry[])
    .map((entry) => [entry.gateKey, entry.routeKey, entry.generation]);
  return JSON.stringify(canonical(left.launchEntriesJson)) === JSON.stringify(canonical(right.launchEntriesJson));
}

/**
 * Immutable identity of the work this attempt stands for. Stored on create and compared on every
 * upsert hit, so a reused key that names different work conflicts instead of silently returning —
 * and resuming — someone else's row.
 *
 * It covers the WHOLE identity, not just the source ids: the sequence (a Resume is different work
 * from the attempt it replaces), the expanded required-feature set and the route vector (the same
 * source dispatched under a different guard is different work, and the vector it will be checked
 * against is part of what the key promises), and the retained-artifact policy.
 */
export function attemptIdentityFingerprint(input: {
  companyId: string | null;
  sourceType: string;
  sourceId: string;
  attemptKey: string;
  attemptSeq?: number;
  featureKeys?: readonly string[];
  routes?: readonly LaunchRouteRef[];
  retainedArtifactPolicy?: string | null;
}): string {
  const canonical = JSON.stringify([
    IDENTITY_FINGERPRINT_VERSION,
    attemptScope(input.companyId),
    input.sourceType,
    input.sourceId,
    input.attemptKey,
    input.attemptSeq ?? 1,
    expandRequiredFeatureKeys(input.featureKeys ?? []),
    normalizeRoutes(input.routes ?? []).map((route) => [route.gateKey, route.routeKey]),
    input.retainedArtifactPolicy ?? null,
  ]);
  return `${IDENTITY_FINGERPRINT_VERSION}:${createHash('sha256').update(canonical).digest('hex')}`;
}

/**
 * Structural identity for a row written before `IDENTITY_FINGERPRINT_VERSION`: its digest hashed a
 * narrower identity, so it is not comparable with today's and is compared field by field instead of
 * being rejected wholesale (spec:63 forbids back-stamping it).
 *
 * It covers everything the fingerprint covers, not just the source triple. A migrated row also
 * carries the GUARD VECTOR it was stamped with — the required feature set, the route vector and the
 * retained-artifact policy — and adopting a row whose work will be checked against a DIFFERENT
 * vector is exactly the hole the fingerprint exists to close, so any drift fails closed.
 *
 * Route GENERATIONS are deliberately excluded: a stale generation is a claim-time suppression, not
 * an identity conflict, and re-stamping it is forbidden.
 */
function legacyIdentityHolds(
  row: {
    companyScope: string;
    sourceType: string;
    sourceId: string;
    attemptSeq: number;
    entitlementEpochsJson: unknown;
    launchEntriesJson: unknown;
    retainedArtifactPolicy: string | null;
  },
  expected: {
    companyScope: string;
    sourceType: string;
    sourceId: string;
    attemptSeq: number;
    /** Already expanded and sorted by `expandRequiredFeatureKeys`. */
    featureKeys: readonly string[];
    /** Already normalized and sorted by `normalizeRoutes`. */
    routes: readonly { gateKey: string; routeKey: string }[];
    retainedArtifactPolicy: string | null;
  },
): boolean {
  const storedKeys = Object.keys((row.entitlementEpochsJson ?? {}) as StampedEpochs).sort();
  const storedRoutes = ((row.launchEntriesJson ?? []) as unknown as StampedLaunchEntry[])
    .map((entry) => `${entry.gateKey}:${entry.routeKey}`)
    .sort();
  const wantedRoutes = expected.routes.map((route) => `${route.gateKey}:${route.routeKey}`);
  const sameList = (a: readonly string[], b: readonly string[]) =>
    a.length === b.length && a.every((value, index) => value === b[index]);

  return row.companyScope === expected.companyScope
    && row.sourceType === expected.sourceType
    && row.sourceId === expected.sourceId
    && row.attemptSeq === expected.attemptSeq
    && (row.retainedArtifactPolicy ?? null) === (expected.retainedArtifactPolicy ?? null)
    && sameList(storedKeys, expected.featureKeys)
    && sameList(storedRoutes, wantedRoutes);
}

/** Owning keys plus every declared prerequisite, deduplicated and in canonical order (spec:59). */
export function expandRequiredFeatureKeys(featureKeys: readonly string[]): string[] {
  const out = new Set<string>();
  const pending = [...featureKeys];
  while (pending.length > 0) {
    const key = pending.pop()!;
    if (out.has(key)) continue;
    out.add(key);
    pending.push(...requiredFeatureKeys(key));
  }
  return [...out].sort();
}

/**
 * spec:61 batch-eligibility key. Deliberately covers the company AND the complete vector, so it can
 * never be reused across a company, a vector, an epoch or a generation.
 *
 * F1.5.2 owner ruling 4 — it also covers the DEPLOYMENT the vector was stamped on. An availability
 * vector is only meaningful together with the environment and build whose gate approval it read
 * (`deploymentViolation`), so two rows stamped on different builds are NOT batch-eligible even when
 * every epoch and generation matches: a future bounded batch claim must never mix builds, because a
 * single claim decision cannot be right for two of them at once.
 */
export function availabilityVectorHash(
  companyId: string | null,
  epochs: StampedEpochs,
  entries: readonly StampedLaunchEntry[],
  deployment: { targetEnvironment: string; buildReleaseId: string },
): string {
  const canonical = JSON.stringify({
    companyId,
    epochs: Object.keys(epochs).sort().map((key) => [key, epochs[key] ?? null]),
    entries: entries.map((entry) => [entry.gateKey, entry.routeKey, entry.generation]),
    targetEnvironment: deployment.targetEnvironment,
    buildReleaseId: deployment.buildReleaseId,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

@Injectable()
export class ExecutionAttemptService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(LOGGER_TOKEN) private readonly logger: AppLogger,
    /** Server truth for the running deployment (spec:54); never a caller-supplied environment/build. */
    private readonly config: AppConfigService,
  ) {}

  /**
   * spec:59 — every queued/outbound/final-mutation work row created after rollout stores the
   * availability vector of EVERY required feature, not only its owner. Scanner/outbox paths without
   * a durable queue row create a stamped attempt before acting.
   */
  async createStampedAttempt(input: CreateStampedAttemptInput): Promise<StampedAttempt> {
    const featureKeys = expandRequiredFeatureKeys(input.featureKeys);
    const routes = normalizeRoutes(input.routes);
    const attemptSeq = input.attemptSeq ?? 1;

    const epochs = await this.readEpochs(this.prisma.client, input.companyId, featureKeys);
    const entries = await this.readLaunchEntries(this.prisma.client, routes);
    const storedKey = scopedAttemptKey(input.companyId, input.attemptKey, attemptSeq);
    const fingerprint = attemptIdentityFingerprint({ ...input, attemptSeq });
    const companyScope = attemptScope(input.companyId);
    // WHICH deployment's gate approval this vector was read under (F1.5.2 blocker 2). Server truth,
    // and deliberately NOT part of the fingerprint: the same work re-stamped from the next build is
    // the same attempt, not a conflicting one — only the claim/dispatch fence cares about the build.
    const deployment = this.config.deploymentIdentity;
    const hash = availabilityVectorHash(input.companyId, epochs, entries, deployment);

    // Every part of this transaction is load-bearing for idempotency under concurrency, and none is
    // sufficient alone — `execution-attempt.service.race.spec.ts` races them for real.
    //
    // The locks serialize two callers stamping the SAME work. The update is a NO-OP SELF-ASSIGNMENT
    // of the very column that was matched: it re-stamps nothing (spec:63 forbids back-stamping an
    // existing attempt with today's epochs/generations), and a non-empty `update` is what makes
    // Prisma compile ONE `INSERT … ON CONFLICT DO UPDATE` — an empty one compiles to
    // SELECT-then-INSERT, whose loser raises P2002 instead of returning the attempt it asked for.
    const row = await this.prisma.client.$transaction(async (tx) => {
      // Canonical SOURCE identity first, then the key — one global order, so two stampers can never
      // hold one lock each and wait on the other.
      await tx.$executeRaw(attemptSourceIdentityLock(companyScope, input.sourceType, input.sourceId, attemptSeq));
      await tx.$executeRaw(attemptIdentityLock(storedKey));

      // Inside BOTH locks, so this read is a fence and not a hope: a caller naming this same work
      // under a different key is either already committed and visible here, or is still waiting on
      // the source lock. Without it the upsert (which arbitrates on `attemptKey` alone) hits the
      // source unique and raises a bare P2002 that no caller can act on.
      const bySource = await tx.executionAttempt.findUnique({
        where: {
          companyScope_sourceType_sourceId_attemptSeq: {
            companyScope,
            sourceType: input.sourceType,
            sourceId: input.sourceId,
            attemptSeq,
          },
        },
        select: { attemptKey: true },
      });
      if (bySource && bySource.attemptKey !== storedKey) {
        throw new ConflictException({
          code: 'execution_attempt_identity_conflict',
          message: 'This work already has an attempt under a different key. Reuse that key, or mint a new attempt sequence.',
          attemptKey: input.attemptKey,
          conflictingAttemptKey: bySource.attemptKey,
        });
      }

      return tx.executionAttempt.upsert({
        where: { attemptKey: storedKey },
        create: {
          companyId: input.companyId,
          companyScope,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          attemptKey: storedKey,
          identityFingerprint: fingerprint,
          attemptSeq,
          entitlementEpochsJson: epochs as Prisma.InputJsonValue,
          launchEntriesJson: entries as unknown as Prisma.InputJsonValue,
          availabilityVectorHash: hash,
          targetEnvironment: deployment.targetEnvironment,
          buildReleaseId: deployment.buildReleaseId,
          retainedArtifactPolicy: input.retainedArtifactPolicy ?? null,
        },
        update: { attemptKey: storedKey },
        select: {
          id: true,
          companyScope: true,
          sourceType: true,
          sourceId: true,
          attemptSeq: true,
          identityFingerprint: true,
          status: true,
          entitlementEpochsJson: true,
          launchEntriesJson: true,
          availabilityVectorHash: true,
          retainedArtifactPolicy: true,
        },
      });
    });

    // An upsert HIT must be this company's own work, at this sequence, under this guard vector. A
    // row written before `IDENTITY_FINGERPRINT_VERSION` hashed a narrower identity, so its digest is
    // not comparable — `legacyIdentityHolds` compares the SAME identity structurally (source,
    // sequence, feature set, route vector, policy) instead of rejecting it (spec:63 forbids
    // back-stamping it), and any drift fails closed.
    const legacyIdentity = row.identityFingerprint == null
      || !row.identityFingerprint.startsWith(`${IDENTITY_FINGERPRINT_VERSION}:`);
    const identityHolds = legacyIdentity
      ? legacyIdentityHolds(row, {
        companyScope,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        attemptSeq,
        featureKeys,
        routes,
        retainedArtifactPolicy: input.retainedArtifactPolicy ?? null,
      })
      : row.identityFingerprint === fingerprint;
    if (!identityHolds) {
      throw new ConflictException({
        code: 'execution_attempt_identity_conflict',
        message: 'This attempt key already identifies different work. Mint a new key or a new attempt sequence.',
        attemptKey: input.attemptKey,
      });
    }

    return {
      id: row.id,
      status: row.status,
      entitlementEpochs: row.entitlementEpochsJson as StampedEpochs,
      launchEntries: row.launchEntriesJson as unknown as StampedLaunchEntry[],
      availabilityVectorHash: row.availabilityVectorHash,
    };
  }

  /**
   * spec:60 — QUEUED→CLAIMED under the canonical lock protocol (tenant-local entitlement first,
   * then global launch-gate rows sorted by `(gateKey, routeKey)`; the gate side takes the SHARED
   * lock so many tenants never serialize on one global route, while OPEN/CLOSE takes the exclusive
   * side). Inside that fence the claimant performs an UNCACHED read — a cached read is not a fence
   * — and requires every entitlement epoch to match, every required feature to still be enabled and
   * every stamped gate to be OPEN at the same generation.
   *
   * `onClaimed` runs in the claim transaction so a database final mutation commits with the guard
   * (spec:60). It must not perform network I/O: no DB lock may be held across the network.
   */
  async claimAttempt(
    attemptId: string,
    opts: { treatment?: TerminalTreatment; onClaimed?: (tx: Prisma.TransactionClient) => Promise<void> } = {},
  ): Promise<ClaimOutcome> {
    const treatment = opts.treatment ?? 'SUPPRESS';
    return this.prisma.client.$transaction(async (tx) => {
      const attempt = await tx.executionAttempt.findUnique({
        where: { id: attemptId },
        select: {
          id: true,
          companyId: true,
          status: true,
          entitlementEpochsJson: true,
          launchEntriesJson: true,
          targetEnvironment: true,
          buildReleaseId: true,
        },
      });
      if (!attempt) throw new NotFoundException({ code: 'execution_attempt_not_found', attemptId });
      // A terminal row never revives, and an already-claimed row is not re-claimed: a concurrent
      // disable/close either commits first and prevents the claim, or observes this (spec:60/64).
      if (attempt.status !== 'QUEUED') {
        return { claimed: false, status: attempt.status, reason: 'not_queued' };
      }

      const epochs = (attempt.entitlementEpochsJson ?? {}) as StampedEpochs;
      const entries = sortedStampedEntries((attempt.launchEntriesJson ?? []) as unknown as StampedLaunchEntry[]);

      if (attempt.companyId) await tx.$executeRaw(sharedEntitlementLock(attempt.companyId));
      for (const entry of entries) await tx.$executeRaw(sharedLaunchGateLock(entry.gateKey, entry.routeKey));

      const featureReason = await this.entitlementViolation(tx, attempt.companyId, epochs);
      if (featureReason) {
        return this.terminalize(tx, attemptId, treatment === 'SKIP' ? 'SKIPPED_FEATURE_DISABLED' : 'SUPPRESSED_FEATURE_DISABLED', featureReason);
      }

      const gateReason = await this.launchGateViolation(tx, entries);
      if (gateReason) {
        return this.terminalize(tx, attemptId, treatment === 'SKIP' ? 'SKIPPED_LAUNCH_GATE_CLOSED' : 'SUPPRESSED_LAUNCH_GATE_CLOSED', gateReason);
      }

      const deploymentReason = await this.deploymentViolation(tx, attempt, entries);
      if (deploymentReason) {
        return this.terminalize(tx, attemptId, treatment === 'SKIP' ? 'SKIPPED_LAUNCH_GATE_CLOSED' : 'SUPPRESSED_LAUNCH_GATE_CLOSED', deploymentReason);
      }

      const cas = await tx.executionAttempt.updateMany({
        where: { id: attemptId, status: 'QUEUED' },
        data: { status: 'CLAIMED', claimedAt: new Date(), attempts: { increment: 1 } },
      });
      if (cas.count !== 1) return { claimed: false, status: 'QUEUED', reason: 'lost_claim_race' };

      await opts.onClaimed?.(tx);
      return { claimed: true, status: 'CLAIMED' };
    });
  }

  /**
   * spec:62 — external I/O uses a durable token/lease as its linearization boundary. The token is
   * minted once and reused on resume because it doubles as the provider idempotency key.
   *
   * Resumable: CLAIMED, or DISPATCHING whose lease expired BEFORE the provider was invoked
   * (plan:40). Never resumable once `dispatchedAt` is set — an HTTP request already dispatched
   * cannot be unsent, so that row is explicitly in flight and belongs to
   * `markUnknownExternalOutcome` or a recorded provider result.
   *
   * P0-2 — MINTING THE TOKEN IS ITSELF A FENCE. The claim can be arbitrarily older than the
   * dispatch (a queued row, a retry, a resumed lease), so "close before token prevents dispatch"
   * only holds if the availability vector is re-checked HERE, under the same shared locks the
   * claim takes, in the same transaction that writes the token. A vector that no longer holds
   * mints nothing and terminalizes the attempt under its matrix treatment.
   */
  async acquireDispatchLease(
    attemptId: string,
    leaseOwner: string,
    ttlMs = DEFAULT_DISPATCH_LEASE_MS,
    opts: { treatment?: TerminalTreatment } = {},
  ): Promise<DispatchLease | null> {
    const now = new Date();
    const treatment = opts.treatment ?? 'SUPPRESS';
    return this.prisma.client.$transaction(async (tx) => {
      // Read the IMMUTABLE lock vector first, then take the canonical company/routes locks, and only
      // then lock the row. Taking `FOR UPDATE` first inverts completion's company -> domain-row order:
      // a completer inspecting this attempt could hold company and wait row while this lease held row
      // and waited company. The locked re-read below verifies the vector did not change.
      const preflight = await tx.executionAttempt.findUnique({
        where: { id: attemptId },
        select: {
          companyId: true,
          status: true,
          dispatchToken: true,
          dispatchedAt: true,
          leaseOwner: true,
          leaseExpiresAt: true,
          leaseGeneration: true,
          entitlementEpochsJson: true,
          launchEntriesJson: true,
          targetEnvironment: true,
          buildReleaseId: true,
        },
      });
      if (!preflight) throw new NotFoundException({ code: 'execution_attempt_not_found', attemptId });
      if (preflight.companyId) await tx.$executeRaw(sharedEntitlementLock(preflight.companyId));
      const preflightEntries = sortedStampedEntries(
        (preflight.launchEntriesJson ?? []) as unknown as StampedLaunchEntry[],
      );
      for (const entry of preflightEntries) {
        await tx.$executeRaw(sharedLaunchGateLock(entry.gateKey, entry.routeKey));
      }

      // The row lock still makes an expired-lease takeover single-winner. It is simply acquired
      // after the advisory locks so every path has one global order.
      const [attempt] = await tx.$queryRaw<LockedAttemptRow[]>(Prisma.sql`
        SELECT "companyId", "status"::text AS "status", "dispatchToken", "dispatchedAt",
               "leaseOwner", "leaseExpiresAt", "leaseGeneration",
               "entitlementEpochsJson", "launchEntriesJson",
               "targetEnvironment", "buildReleaseId"
        FROM "ExecutionAttempt" WHERE "id" = ${attemptId} FOR UPDATE
      `);
      if (!attempt) throw new NotFoundException({ code: 'execution_attempt_not_found', attemptId });
      if (!sameLockVector(preflight, attempt)) {
        throw new ConflictException({
          code: 'execution_attempt_lock_vector_changed',
          message: 'The immutable execution-attempt lock vector changed; retry with a newly stamped attempt.',
          attemptId,
        });
      }
      if (attempt.dispatchedAt) return null;
      if (attempt.status !== 'CLAIMED' && attempt.status !== 'DISPATCHING') return null;
      if (attempt.status === 'DISPATCHING' && attempt.leaseExpiresAt && attempt.leaseExpiresAt > now) return null;

      const epochs = (attempt.entitlementEpochsJson ?? {}) as StampedEpochs;
      const entries = sortedStampedEntries((attempt.launchEntriesJson ?? []) as unknown as StampedLaunchEntry[]);

      const featureReason = await this.entitlementViolation(tx, attempt.companyId, epochs);
      if (featureReason) {
        await this.terminalize(
          tx,
          attemptId,
          treatment === 'SKIP' ? 'SKIPPED_FEATURE_DISABLED' : 'SUPPRESSED_FEATURE_DISABLED',
          featureReason,
          attempt.status,
        );
        return null;
      }
      const gateReason = await this.launchGateViolation(tx, entries)
        ?? await this.deploymentViolation(tx, attempt, entries);
      if (gateReason) {
        await this.terminalize(
          tx,
          attemptId,
          treatment === 'SKIP' ? 'SKIPPED_LAUNCH_GATE_CLOSED' : 'SUPPRESSED_LAUNCH_GATE_CLOSED',
          gateReason,
          attempt.status,
        );
        return null;
      }

      const dispatchToken = attempt.dispatchToken ?? randomUUID();
      const leaseGeneration = attempt.leaseGeneration + 1;
      // CAS on the EXACT prior lease tuple, not merely on the status: a takeover is only valid
      // against the lease the caller actually observed. The generation bump is what strands the
      // previous holder — every completion path below CASes on it.
      const cas = await tx.executionAttempt.updateMany({
        where: {
          id: attemptId,
          status: attempt.status,
          dispatchedAt: null,
          leaseOwner: attempt.leaseOwner,
          leaseExpiresAt: attempt.leaseExpiresAt,
          leaseGeneration: attempt.leaseGeneration,
        },
        data: {
          status: 'DISPATCHING',
          dispatchToken,
          leaseOwner,
          leaseGeneration,
          leaseExpiresAt: new Date(now.getTime() + ttlMs),
          attempts: { increment: 1 },
        },
      });
      return cas.count === 1 ? { dispatchToken, leaseOwner, leaseGeneration } : null;
    });
  }

  /** Extends a live lease held by this exact fence. An expired lease is re-acquired, never renewed. */
  async renewDispatchLease(attemptId: string, fence: DispatchFence, ttlMs = DEFAULT_DISPATCH_LEASE_MS): Promise<boolean> {
    const now = new Date();
    const cas = await this.prisma.client.executionAttempt.updateMany({
      where: { id: attemptId, ...this.fenceWhere(fence), leaseExpiresAt: { gt: now } },
      data: { leaseExpiresAt: new Date(now.getTime() + ttlMs) },
    });
    return cas.count === 1 || this.staleFence('renewDispatchLease', attemptId, fence);
  }

  /**
   * The durable "about to call the provider" record. It MUST commit before the network call: it is
   * the only thing that distinguishes a resumable pre-invocation crash from an ambiguous
   * post-dispatch one (spec:62, plan:40).
   */
  async markDispatchStarted(attemptId: string, fence: DispatchFence, providerRequestRef?: string): Promise<boolean> {
    const cas = await this.prisma.client.executionAttempt.updateMany({
      // The lease must still be UNEXPIRED. A worker that stalled past its TTL has already been
      // overtaken (or is about to be), and must not send the request it was about to send.
      where: { id: attemptId, ...this.fenceWhere(fence), leaseExpiresAt: { gt: new Date() }, dispatchedAt: null },
      data: { dispatchedAt: new Date(), providerRequestRef: providerRequestRef ?? null },
    });
    return cas.count === 1 || this.staleFence('markDispatchStarted', attemptId, fence);
  }

  /**
   * spec:62 — a crash/timeout AFTER dispatch with no authoritative result. Poll the provider or
   * require one prefilled manual reconciliation; never blind-retry and never claim failure or
   * success. Only reachable from a dispatched row, so it can never swallow un-sent work.
   */
  async markUnknownExternalOutcome(attemptId: string, reason: string, fence: DispatchFence): Promise<boolean> {
    const cas = await this.prisma.client.executionAttempt.updateMany({
      where: { id: attemptId, ...this.fenceWhere(fence), dispatchedAt: { not: null } },
      data: {
        status: 'UNKNOWN_EXTERNAL_OUTCOME',
        terminalAt: new Date(),
        lastError: reason,
        leaseOwner: null,
        leaseExpiresAt: null,
        providerLastCheckedAt: new Date(),
      },
    });
    return cas.count === 1 || this.staleFence('markUnknownExternalOutcome', attemptId, fence);
  }

  /**
   * spec:62 — the DEFINITIVE provider failure: the provider answered, and it answered "no". Nothing
   * was effected, so this terminal is the one that Resume/Reissue may later mint a NEW attemptSeq
   * against — unlike `UNKNOWN_EXTERNAL_OUTCOME`, which must be reconciled before anything retries.
   *
   * Because it is the claim that unblocks a retry, it is the strictest write here: the exact fence,
   * a durable `dispatchedAt` (a provider cannot have answered a request that was never sent) AND an
   * UNEXPIRED lease. A holder that cannot still prove it owns the row cannot prove the answer it
   * carries is this row's — that worker's honest terminal is `markUnknownExternalOutcome`, which
   * deliberately does not require an unexpired lease.
   */
  async markFailedConfirmed(attemptId: string, fence: DispatchFence, evidenceRef?: string): Promise<boolean> {
    const now = new Date();
    const cas = await this.prisma.client.executionAttempt.updateMany({
      where: { id: attemptId, ...this.fenceWhere(fence), leaseExpiresAt: { gt: now }, dispatchedAt: { not: null } },
      data: {
        status: 'FAILED_CONFIRMED',
        terminalAt: now,
        lastError: evidenceRef ?? 'provider reported a definitive failure',
        leaseOwner: null,
        leaseExpiresAt: null,
        providerLastCheckedAt: now,
      },
    });
    return cas.count === 1 || this.staleFence('markFailedConfirmed', attemptId, fence);
  }

  /**
   * The authoritative provider/DB result, recorded once.
   *
   * With a `fence` this is the DISPATCHING completion and requires the EXACT lease that dispatched:
   * a worker whose expired lease was taken over carries a stale generation, so its CAS matches no
   * row and it no-ops instead of stamping SUCCEEDED over the new holder's in-flight work or over a
   * terminal the guard already wrote.
   *
   * It ALSO requires a durable `dispatchedAt` (F1.5.2). Holding the lease is not evidence that the
   * provider was called: `markDispatchStarted` is what commits before the network call, and success
   * recorded without it would claim an outcome for a request that provably never left this process,
   * making the row indistinguishable from a real send when it is later reconciled.
   *
   * Without a fence it is the CLAIMED completion for work that never left the database, and is
   * fenced by requiring that no lease was ever taken (`leaseOwner`/`dispatchToken` still null).
   */
  async markSucceeded(attemptId: string, fence?: DispatchFence, providerRequestRef?: string): Promise<boolean> {
    const where = fence
      ? { id: attemptId, ...this.fenceWhere(fence), dispatchedAt: { not: null } }
      : { id: attemptId, status: 'CLAIMED' as const, leaseOwner: null, dispatchToken: null };
    const cas = await this.prisma.client.executionAttempt.updateMany({
      where,
      data: {
        status: 'SUCCEEDED',
        terminalAt: new Date(),
        leaseOwner: null,
        leaseExpiresAt: null,
        ...(providerRequestRef ? { providerRequestRef } : {}),
      },
    });
    if (cas.count === 1) return true;
    return fence ? this.staleFence('markSucceeded', attemptId, fence) : false;
  }

  /**
   * The CAS predicate every post-dispatch write shares: the row is still DISPATCHING AND still held
   * by this exact owner at this exact generation (and, when the caller carries it, this exact
   * provider idempotency key).
   */
  private fenceWhere(fence: DispatchFence) {
    return {
      status: 'DISPATCHING' as const,
      leaseOwner: fence.leaseOwner,
      leaseGeneration: fence.leaseGeneration,
      ...(fence.dispatchToken ? { dispatchToken: fence.dispatchToken } : {}),
    };
  }

  /** A stale worker is expected, not exceptional: it records evidence and returns false. Never throws. */
  private staleFence(op: string, attemptId: string, fence: DispatchFence): false {
    this.logger.warn(
      { event: 'execution_attempt.stale_fence', op, attemptId, leaseOwner: fence.leaseOwner, leaseGeneration: fence.leaseGeneration },
      'execution_attempt.stale_fence',
    );
    return false;
  }

  private async readEpochs(
    db: Prisma.TransactionClient | PrismaService['client'],
    companyId: string | null,
    featureKeys: readonly string[],
  ): Promise<StampedEpochs> {
    const epochs: StampedEpochs = {};
    if (!companyId) return epochs;
    const rows = await db.companyFeatureEntitlement.findMany({
      where: { companyId, featureKey: { in: [...featureKeys] } },
      select: { featureKey: true, epoch: true },
    });
    const byKey = new Map(rows.map((row) => [row.featureKey, row.epoch]));
    for (const key of featureKeys) epochs[key] = byKey.get(key) ?? null;
    return epochs;
  }

  private async readLaunchEntries(
    db: Prisma.TransactionClient | PrismaService['client'],
    routes: readonly { gateKey: string; routeKey: string }[],
  ): Promise<StampedLaunchEntry[]> {
    if (routes.length === 0) return [];
    const gates = await db.featureLaunchGate.findMany({
      where: { OR: routes.map((route) => ({ gateKey: route.gateKey, routeKey: route.routeKey })) },
      select: { gateKey: true, routeKey: true, generation: true },
    });
    const byKey = new Map(gates.map((gate) => [`${gate.gateKey} ${gate.routeKey}`, gate.generation]));
    // An absent row stamps generation 0, matching the schema default and the guard's "absent =
    // CLOSED": a route the bootstrap never materialized has never been opened.
    return routes.map((route) => ({ ...route, generation: byKey.get(`${route.gateKey} ${route.routeKey}`) ?? 0 }));
  }

  /**
   * Returns the violation reason, or null when the entitlement half of the vector still holds.
   *
   * Both halves are required. `epoch` alone cannot see a disable — spec:51 increments it only on a
   * real non-ON→ON transition, NOT on disable — so `enabled` is checked too; and `enabled` alone
   * cannot see a disable+re-enable, which is exactly what the epoch fences.
   */
  private async entitlementViolation(
    tx: Prisma.TransactionClient,
    companyId: string | null,
    epochs: StampedEpochs,
  ): Promise<string | null> {
    const featureKeys = Object.keys(epochs);
    if (!companyId || featureKeys.length === 0) return null;
    const rows = await tx.companyFeatureEntitlement.findMany({
      where: { companyId, featureKey: { in: featureKeys } },
      select: { featureKey: true, enabled: true, epoch: true },
    });
    const byKey = new Map(rows.map((row) => [row.featureKey, row]));
    for (const featureKey of featureKeys) {
      const row = byKey.get(featureKey);
      const stamped = epochs[featureKey] ?? null;
      // Legacy fail-open (`loadEntitledFeatureKeys` returns null for a company with no rows): the
      // work was stamped with no row and there is still no row, so nothing changed. Once F2
      // normalization materializes rows, that becomes a real epoch mismatch — which is precisely
      // the pre-ship NULL-stamped reconciliation spec:63 requires, never a silent back-stamp.
      if (!row) {
        if (stamped === null) continue;
        return `feature ${featureKey} entitlement row disappeared (stamped epoch ${stamped})`;
      }
      if (stamped === null) return `feature ${featureKey} was stamped without an entitlement row but now has epoch ${row.epoch}`;
      if (!row.enabled) return `feature ${featureKey} is disabled`;
      if (row.epoch !== stamped) return `feature ${featureKey} epoch ${row.epoch} != stamped ${stamped}`;
    }
    return null;
  }

  /** Returns the violation reason, or null when every stamped route is OPEN at its generation. */
  private async launchGateViolation(tx: Prisma.TransactionClient, entries: readonly StampedLaunchEntry[]): Promise<string | null> {
    if (entries.length === 0) return null;
    const gates = await tx.featureLaunchGate.findMany({
      where: { OR: entries.map((entry) => ({ gateKey: entry.gateKey, routeKey: entry.routeKey })) },
      select: { gateKey: true, routeKey: true, state: true, generation: true },
    });
    const byKey = new Map(gates.map((gate) => [`${gate.gateKey} ${gate.routeKey}`, gate]));
    for (const entry of entries) {
      const gate = byKey.get(`${entry.gateKey} ${entry.routeKey}`);
      if (!gate || gate.state !== 'OPEN') return `route ${entry.gateKey}:${entry.routeKey} is CLOSED`;
      if (gate.generation !== entry.generation) {
        return `route ${entry.gateKey}:${entry.routeKey} generation ${gate.generation} != stamped ${entry.generation}`;
      }
    }
    return null;
  }

  /**
   * Returns the violation reason, or null when the DEPLOYMENT half of the vector still holds
   * (F1.5.2 blocker 2 + owner ruling 1). `state = OPEN` is not authorization on its own: an OPEN
   * carries the environment and build it was approved against.
   *
   * DUAL BUILD. The owner ruling deliberately does NOT force `stampedBuild === runningBuild` — that
   * would refuse every in-flight row the moment a rolling deploy attests the incoming build. Instead
   * BOTH builds must independently still hold authority, on the SAME route and generation:
   *
   *  (a) the STAMPED build — the approval this work's availability vector was actually read under;
   *  (b) the RUNNING build — this process may not act on ANY queued work under an approval that does
   *      not cover the code about to execute it, however well-authorized the stamp was;
   *  (c) the environment, and the generation. The environment is compared directly; the generation is
   *      the `entry.generation` used in the lookup, and `launchGateViolation` — which every caller
   *      runs first — has already required it to equal the route's live generation, so an attestation
   *      of a dead generation can never be found here.
   *
   * The authority rule itself is the guard's (`liveAttestationKeys`), not a second copy: a retired
   * build's attestation is superseded and stops admitting anything, which is what keeps the window
   * bounded at {current, previous} rather than a permanent allowlist. The read is batched over both
   * builds and every stamped route, so this stays one query.
   *
   * A row that carries no deployment identity (stamped before the columns existed) cannot prove
   * anything and is treated as CLOSED, never waved through.
   */
  private async deploymentViolation(
    tx: Prisma.TransactionClient,
    attempt: StampedDeployment,
    entries: readonly StampedLaunchEntry[],
  ): Promise<string | null> {
    const deployment = this.config.deploymentIdentity;
    if (!attempt.targetEnvironment || !attempt.buildReleaseId) {
      return 'attempt carries no deployment identity (stamped before the vector recorded one)';
    }
    if (attempt.targetEnvironment !== deployment.targetEnvironment) {
      return `attempt was stamped in ${attempt.targetEnvironment}, running ${deployment.targetEnvironment}`;
    }
    if (entries.length === 0) return null;

    const builds: Array<{ role: string; buildReleaseId: string }> = [{ role: 'stamped', buildReleaseId: attempt.buildReleaseId }];
    if (deployment.buildReleaseId !== attempt.buildReleaseId) {
      builds.push({ role: 'running', buildReleaseId: deployment.buildReleaseId });
    }

    const markers = await tx.featureLaunchGateTransition.findMany({
      where: {
        targetEnvironment: deployment.targetEnvironment,
        buildReleaseId: { in: builds.map((build) => build.buildReleaseId) },
        OR: entries.map((entry) => ({ gateKey: entry.gateKey, routeKey: entry.routeKey, generation: entry.generation })),
      },
      select: { gateKey: true, routeKey: true, buildReleaseId: true, action: true, seq: true },
    });
    const live = liveAttestationKeys(markers);
    for (const entry of entries) {
      for (const build of builds) {
        if (live.has(attestationKey({ ...entry, buildReleaseId: build.buildReleaseId }))) continue;
        return `route ${entry.gateKey}:${entry.routeKey} has no OPEN attestation for build ${build.buildReleaseId}`
          + ` in ${deployment.targetEnvironment} at generation ${entry.generation} (the ${build.role} build)`;
      }
    }
    return null;
  }

  /** `from` is the status this terminal is CASed against: QUEUED for a claim, CLAIMED/DISPATCHING
   * for the pre-dispatch fence. The lease is released so nothing blind-retries the row. */
  private async terminalize(
    tx: Prisma.TransactionClient,
    attemptId: string,
    status: 'SUPPRESSED_FEATURE_DISABLED' | 'SKIPPED_FEATURE_DISABLED' | 'SUPPRESSED_LAUNCH_GATE_CLOSED' | 'SKIPPED_LAUNCH_GATE_CLOSED',
    reason: string,
    from: 'QUEUED' | 'CLAIMED' | 'DISPATCHING' = 'QUEUED',
  ): Promise<ClaimOutcome> {
    const cas = await tx.executionAttempt.updateMany({
      where: { id: attemptId, status: from },
      data: { status, terminalAt: new Date(), lastError: reason, leaseOwner: null, leaseExpiresAt: null },
    });
    if (cas.count !== 1) return { claimed: false, status: from, reason: 'lost_claim_race' };
    this.logger.warn({ event: 'execution_attempt.terminal', attemptId, status, reason }, 'execution_attempt.terminal');
    return { claimed: false, status, reason };
  }
}
