/**
 * CC1 safe-OFF / runoff lifecycle: `ON -> DISABLE_REQUESTED -> DRAINING -> OFF` (spec:59-60, 69).
 *
 * Exported as BARE FUNCTIONS, not an injectable, matching the two existing cross-module entitlement
 * helpers the partner command already imports this way (`exclusiveEntitlementLock` from this module,
 * `humanDecidedKeys` from employee-access). No DI shape change means no `test:boot` risk for a piece
 * whose whole point is that it changes no wiring.
 *
 * ── THE STATE MODEL (coordinator ruling OQ-2) ─────────────────────────────────────────────────
 * DRAINING is DERIVED, never stored, and the entitlement row goes `enabled=false` in the
 * DISABLE_REQUESTED transaction. spec:60 is dispositive: "A disable request IMMEDIATELY rejects new
 * interactive root mutations and external sends." With `enabled=true` that is simply false —
 * `ExecutionAttemptService.entitlementViolation` would pass and every queued external send would
 * complete. Writing `false` makes every chokepoint that already exists behave correctly with zero
 * new enforcement code:
 *
 *   - `evaluateEntitledFeatureKeys` drops the key    -> new roots get `feature_not_enabled`
 *   - `entitlementViolation` sees `!row.enabled`     -> queued work terminalizes SUPPRESSED/SKIPPED
 *   - both direct row readers filter `enabled: true` -> chart-template-query, expense-auto-post skip
 *   - `wasOn()` is false on re-enable                -> the epoch bump on DRAINING->ON is automatic
 *
 * Ordinary runoff (spec:317, "only roots in the disable-time snapshot ... and only through approved
 * child/compensation actions") is NOT granted to any family: the owner's 2026-08-04 decision is
 * freeze in place — the feature stops, residual data stays stored and dormant, and a re-enable
 * resumes it. Every snapshot is therefore empty and every drain completes on its first pass; the
 * snapshot survives as the immutable record of the cutoff, not as a work list.
 */
import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import type { PrismaService } from '../../../common/database/prisma.service';
import { RUNOFF_MATRIX_VERSION } from '../domain/runoff-matrix.catalog';
import { exclusiveEntitlementLock } from './execution-attempt.service';

/** The literal `EntitlementTransition.actorUserId` for a system actor (spec:54). */
const SYSTEM_ACTOR = 'SYSTEM';

/**
 * The immutable `RunoffSnapshot.rootsJson` payload.
 *
 * `matrixVersion` is stamped so a later matrix revision can never reinterpret an old snapshot —
 * the same reason `FeatureLaunchObservationBucket` stores `wouldBlock` although it is derivable.
 */
export type RunoffRoots = {
  matrixVersion: string;
  /** rootType -> the matrix policy that admitted it. Empty when the family has no runoff roots. */
  policyByRootType: Record<string, string>;
  roots: Array<{ rootType: string; rootId: string; versionOrHash: string; status: string }>;
  /** Cutoff-time diagnostic only. Completion always re-reads current domain truth. */
  openCount: number;
};

export type RunoffRoot = RunoffRoots['roots'][number];
export type RunoffRootCurrentEvidence = {
  companyId: string;
  rootType: string;
  rootId: string;
  versionOrHash: string;
  terminal: boolean;
  open: boolean;
};

export const MAX_RUNOFF_ROOTS_PER_SNAPSHOT = 500;
export const MAX_RUNOFF_INSPECTION_QUERIES = 4;
export const RUNOFF_INSPECTION_TIMEOUT_MS = 500;
export const MAX_DRAINING_HEALTH_INSPECTIONS = 1_000;
export const RUNOFF_HEALTH_INSPECTION_BUDGET_MS = 2_000;

export type RunoffInspectionReader = {
  /** Executes only a bounded, non-locking SELECT. Mutation/locking SQL is rejected centrally. */
  query<T>(query: Prisma.Sql): Promise<readonly T[]>;
};

/**
 * A family adapter re-reads CURRENT domain truth for the immutable member list. `rootsJson`
 * membership never changes; the old stamped `openCount` is deliberately absent from this contract
 * because it can never prove that work completed after the disable transaction.
 */
export type RunoffCompletionInspector = {
  rootTypes: readonly string[];
  matrixVersions: readonly string[];
  inspectCurrent(input: {
    reader: RunoffInspectionReader;
    companyId: string;
    featureKey: string;
    disableSeq: number;
    cutoffAt: Date;
    roots: readonly RunoffRoot[];
  }): Promise<readonly RunoffRootCurrentEvidence[]>;
};

export type RunoffCompletionInspectors = Readonly<Record<string, RunoffCompletionInspector>>;
const NO_RUNOFF_COMPLETION_INSPECTORS: RunoffCompletionInspectors = {};

export type DrainingState = {
  featureKey: string;
  /** The `seq` of the DISABLE_REQUESTED transition this drain belongs to. */
  disableSeq: number;
  cutoffAt: Date;
  requestedAt: Date;
  openItems: number;
};

/**
 * spec:60 — "records a cutoff and a `RunoffSnapshot` of ONLY the pre-cutoff roots allowed by the
 * approved matrix; later work cannot join that snapshot."
 *
 * EMPTY FOR EVERY FAMILY, by the owner's 2026-08-04 freeze-in-place decision: a disable grants no
 * continuation to anything, so no root is "allowed to run off" and residual work may never hold a
 * disable up. The snapshot stays as the immutable record of the cutoff, and `enabled=false` is what
 * stops the surfaces (see the state model above). Nothing needs a per-family root builder, which is
 * why this takes no database read and cannot fail.
 */
export function buildRunoffRoots(_featureKey: string): RunoffRoots {
  return { matrixVersion: RUNOFF_MATRIX_VERSION, policyByRootType: {}, roots: [], openCount: 0 };
}

/** The row/query shapes lifecycle reads need; a real transaction and the base Prisma client both fit. */
type LifecycleReader = Pick<
  Prisma.TransactionClient,
  '$queryRaw' | 'entitlementTransition' | 'companyFeatureEntitlement' | 'runoffSnapshot'
>;

function rootIdentity(root: Pick<RunoffRoot, 'rootType' | 'rootId'>): string {
  return `${root.rootType}\u0000${root.rootId}`;
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function readOnlyInspectionSql(query: Prisma.Sql): void {
  const statement = query.strings.join(' ? ').replace(/\s+/g, ' ').trim();
  // A SELECT can still mutate or acquire session/advisory locks through a function call. Family
  // inspectors are evidence readers, never repair hooks, so reject those functions centrally too.
  const forbidden = /;|\b(?:INSERT|UPDATE|DELETE|MERGE|CALL|COPY|LOCK|TRUNCATE|ALTER|CREATE|DROP|GRANT|REVOKE)\b|\bFOR\s+(?:UPDATE|NO\s+KEY\s+UPDATE|SHARE|KEY\s+SHARE)\b|\b(?:PG_(?:TRY_)?ADVISORY_(?:XACT_)?LOCK|SET_CONFIG|NEXTVAL|SETVAL|LO_IMPORT|LO_EXPORT)\s*\(/i;
  if (!/^(?:SELECT|WITH)\b/i.test(statement) || forbidden.test(statement)) {
    throw new Error('runoff_inspector_query_not_readonly: inspectors may execute only non-locking SELECT statements');
  }
}

async function withinInspectionTimeout<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`runoff_inspector_timeout: exceeded ${RUNOFF_INSPECTION_TIMEOUT_MS}ms`)),
          RUNOFF_INSPECTION_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function boundInspectionTransaction(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$executeRaw(Prisma.sql`SET LOCAL statement_timeout = '500ms'`);
  await tx.$executeRaw(Prisma.sql`SET LOCAL lock_timeout = '50ms'`);
}

/**
 * Reads how many immutable snapshot members are STILL open from current domain truth.
 * Empty membership is complete without an adapter. Non-empty membership without a family adapter,
 * an unknown root type, an unreadable root, or an invalid answer all fail closed.
 */
export async function inspectOpenRunoffItems(
  db: LifecycleReader,
  input: {
    companyId: string;
    featureKey: string;
    disableSeq: number;
    cutoffAt: Date;
    rootsJson: unknown;
  },
  inspectors: RunoffCompletionInspectors = NO_RUNOFF_COMPLETION_INSPECTORS,
): Promise<number> {
  const snapshot = input.rootsJson as (Partial<RunoffRoots> & { rootsEnumerated?: boolean }) | null;
  // LEGACY r18-era SENTINEL. A withdrawn design recorded `{rootsEnumerated:false, openCount:0,
  // roots:[]}` for a drain whose roots could not be enumerated. Those three fields are mutually
  // contradictory to every later reader: `openCount: 0` says "drained", the sentinel says "we never
  // looked". Without this branch such a row reads as drained and the sweep appends OFF over
  // unenumerated work — the withdrawn design returning through the back door. Snapshots are
  // IMMUTABLE, so the shape can never be migrated away; it has to die here, structurally, forever.
  if (snapshot && snapshot.rootsEnumerated === false) {
    throw new Error('runoff_snapshot_unreadable: legacy r18-era `rootsEnumerated:false` sentinel — the unenumerated-drain design was withdrawn and such a snapshot must never count as drained');
  }
  if (!plainRecord(snapshot)
    || typeof snapshot.matrixVersion !== 'string' || snapshot.matrixVersion.trim() === ''
    || !plainRecord(snapshot.policyByRootType)
    || !Object.values(snapshot.policyByRootType).every((policy) => typeof policy === 'string' && policy.trim() !== '')
    || !Number.isSafeInteger(snapshot.openCount) || (snapshot.openCount ?? -1) < 0
    || !Array.isArray(snapshot.roots) || (snapshot.openCount ?? 0) > snapshot.roots.length) {
    throw new Error(`runoff_snapshot_unreadable: invalid versioned envelope (${JSON.stringify(input.rootsJson)?.slice(0, 200)})`);
  }
  const roots = snapshot.roots;
  if (roots.length > MAX_RUNOFF_ROOTS_PER_SNAPSHOT) {
    throw new Error(`runoff_snapshot_too_large: ${roots.length} roots exceeds ${MAX_RUNOFF_ROOTS_PER_SNAPSHOT}`);
  }
  const identities = new Set<string>();
  for (const root of roots) {
    if (!root || typeof root !== 'object'
      || typeof root.rootType !== 'string' || root.rootType.trim() === ''
      || typeof root.rootId !== 'string' || root.rootId.trim() === ''
      || typeof root.versionOrHash !== 'string' || root.versionOrHash.trim() === ''
      || typeof root.status !== 'string' || root.status.trim() === '') {
      throw new Error(`runoff_snapshot_unreadable: invalid root identity (${JSON.stringify(root)?.slice(0, 200)})`);
    }
    const identity = rootIdentity(root);
    if (identities.has(identity)) {
      throw new Error(`runoff_snapshot_duplicate_root: ${root.rootType}/${root.rootId}`);
    }
    identities.add(identity);
    if (snapshot.policyByRootType[root.rootType] !== 'PRE_CUTOFF_RUNOFF_ONLY') {
      throw new Error(`runoff_snapshot_policy_mismatch: ${root.rootType}`);
    }
  }
  // An empty immutable membership really is drained. Ignore the historical stamped counter even
  // if it claims otherwise; it describes cutoff time and can never be a live completion signal.
  if (roots.length === 0) return 0;

  const inspector = inspectors[input.featureKey];
  if (!inspector) {
    throw new Error(`runoff_snapshot_inspector_missing: ${input.featureKey} has ${roots.length} immutable roots but no current-domain inspector`);
  }
  if (!inspector.matrixVersions.includes(snapshot.matrixVersion)) {
    throw new Error(`runoff_snapshot_matrix_version_unknown: ${input.featureKey}/${snapshot.matrixVersion}`);
  }
  const supported = new Set(inspector.rootTypes);
  const unknown = roots.find((root) => !supported.has(root.rootType));
  if (unknown) {
    throw new Error(`runoff_snapshot_root_unknown: ${input.featureKey}/${unknown.rootType}`);
  }
  let queryCount = 0;
  const reader: RunoffInspectionReader = {
    query: async <T>(query: Prisma.Sql) => {
      queryCount += 1;
      if (queryCount > MAX_RUNOFF_INSPECTION_QUERIES) {
        throw new Error(`runoff_inspector_query_limit: exceeded ${MAX_RUNOFF_INSPECTION_QUERIES} queries`);
      }
      readOnlyInspectionSql(query);
      return db.$queryRaw<T[]>(query);
    },
  };
  const evidence = await withinInspectionTimeout(inspector.inspectCurrent({
    reader,
    companyId: input.companyId,
    featureKey: input.featureKey,
    disableSeq: input.disableSeq,
    cutoffAt: input.cutoffAt,
    roots,
  }));
  if (queryCount === 0) {
    throw new Error('runoff_inspector_no_domain_read: non-empty completion evidence must come from a bounded domain query');
  }
  if (!Array.isArray(evidence) || evidence.length !== roots.length) {
    throw new Error(`runoff_inspector_coverage_mismatch: expected ${roots.length} roots, received ${Array.isArray(evidence) ? evidence.length : 'non-array'}`);
  }
  const evidenceByIdentity = new Map<string, RunoffRootCurrentEvidence>();
  for (const row of evidence) {
    if (!row || typeof row !== 'object'
      || typeof row.companyId !== 'string' || row.companyId !== input.companyId
      || typeof row.rootType !== 'string' || row.rootType.trim() === ''
      || typeof row.rootId !== 'string' || row.rootId.trim() === ''
      || typeof row.versionOrHash !== 'string' || row.versionOrHash.trim() === ''
      || typeof row.terminal !== 'boolean' || typeof row.open !== 'boolean'
      || row.terminal === row.open) {
      throw new Error('runoff_inspector_evidence_invalid: current evidence must be exactly one of terminal/open');
    }
    const identity = rootIdentity(row);
    if (evidenceByIdentity.has(identity)) {
      throw new Error(`runoff_inspector_duplicate_evidence: ${row.rootType}/${row.rootId}`);
    }
    evidenceByIdentity.set(identity, row);
  }
  for (const root of roots) {
    const current = evidenceByIdentity.get(rootIdentity(root));
    if (!current || current.versionOrHash !== root.versionOrHash) {
      throw new Error(`runoff_inspector_identity_mismatch: ${root.rootType}/${root.rootId}/${root.versionOrHash}`);
    }
  }
  return [...evidenceByIdentity.values()].filter((row) => row.open).length;
}

/**
 * THE DRAINING derivation (spec:69): "derived from latest DISABLE_REQUESTED plus open items in the
 * immutable runoff snapshot".
 *
 * "Latest" is decided by the canonical fence, not by `createdAt`: the entitlement row's `lastSeq`
 * IS the highest transition seq for that key, so `lastSeq === disableRequested.seq` means nothing
 * has happened since. This is the same test `GetLaunchHealthUseCase` already used before this
 * lifecycle existed — extracted here so the health view and the completer cannot drift apart.
 *
 * Returns null when the feature is not draining (never disabled, already OFF, or re-enabled).
 */
export async function drainingStateOf(
  db: LifecycleReader,
  companyId: string,
  featureKey: string,
  inspectors: RunoffCompletionInspectors = NO_RUNOFF_COMPLETION_INSPECTORS,
): Promise<DrainingState | null> {
  const [fence, latestRequest] = await Promise.all([
    db.companyFeatureEntitlement.findUnique({
      where: { companyId_featureKey: { companyId, featureKey } },
      select: { lastSeq: true },
    }),
    db.entitlementTransition.findFirst({
      where: { companyId, featureKey, action: 'DISABLE_REQUESTED' },
      orderBy: { seq: 'desc' },
      select: { seq: true, createdAt: true },
    }),
  ]);
  if (!fence || !latestRequest) return null;
  if ((fence.lastSeq ?? 0) !== latestRequest.seq) return null;

  const snapshot = await db.runoffSnapshot.findUnique({
    where: { companyId_featureKey_disableSeq: { companyId, featureKey, disableSeq: latestRequest.seq } },
    select: { cutoffAt: true, rootsJson: true },
  });
  // A DISABLE_REQUESTED with no snapshot is a broken drain, not a drained one. It is unreachable
  // (both are written in one transaction) but must never read as "0 open items -> complete".
  if (!snapshot) {
    return {
      featureKey,
      disableSeq: latestRequest.seq,
      cutoffAt: latestRequest.createdAt,
      requestedAt: latestRequest.createdAt,
      openItems: Number.POSITIVE_INFINITY,
    };
  }

  const openItems = await inspectOpenRunoffItems(db, {
    companyId,
    featureKey,
    disableSeq: latestRequest.seq,
    cutoffAt: snapshot.cutoffAt,
    rootsJson: snapshot.rootsJson,
  }, inspectors);
  return {
    featureKey,
    disableSeq: latestRequest.seq,
    cutoffAt: snapshot.cutoffAt,
    requestedAt: latestRequest.createdAt,
    openItems,
  };
}

export type CompletionOutcome = 'COMPLETED' | 'ALREADY_COMPLETED' | 'STILL_DRAINING' | 'NOT_DRAINING';

/**
 * spec:69 — "Completion appends OFF."
 *
 * A SEPARATE COMMAND, and not by preference: `EntitlementTransition` carries
 * `@@unique([companyId, featureKey, commandId])` (schema.prisma:6956), so DISABLE_REQUESTED and OFF
 * for one feature cannot share the partner command's id. spec:59 independently lists
 * "Enable/disable/finish-draining" as three commands.
 *
 * Its command id is DERIVED and cycle-unique (`runoff-complete:<featureKey>:<disableSeq>`), so the
 * transition unique index is itself the idempotency fence: the post-commit call and any number of
 * concurrent sweeps converge on exactly one OFF row.
 *
 * What it does NOT do (coordinator ruling OQ-5):
 *   - no `CompanyEntitlementSet.setVersion` bump and no `EntitlementCommand` row. It changes no
 *     member of the entitlement set (`enabled` is already false), and bumping would spuriously
 *     invalidate the operator's freshly-read `expectedSetVersion` immediately after every disable.
 *   - no epoch change (spec:54 — epoch moves only on a real non-ON->ON transition).
 *   - no `updatedAt` restamp: the fence bump is raw SQL, reusing the pattern at
 *     `set-partner-features.use-case.ts:408-412`, because `expense_auto_post.updatedAt` is the
 *     auto-post worker's activation cutoff.
 */
export async function completeRunoffIfDrained(
  prisma: PrismaService,
  companyId: string,
  featureKey: string,
  inspectors: RunoffCompletionInspectors = NO_RUNOFF_COMPLETION_INSPECTORS,
): Promise<CompletionOutcome> {
  return prisma.client.$transaction(async (tx) => {
    // The same exclusive side the partner command takes, so a completion can never interleave with
    // a disable or a re-enable of the same company.
    await tx.$executeRaw(exclusiveEntitlementLock(companyId));
    await boundInspectionTransaction(tx);

    // Re-read UNDER the lock. The state that mattered when the caller decided to call is not the
    // state that matters now: a re-enable may have landed in between, and completing then would
    // switch a live feature off.
    const state = await drainingStateOf(tx, companyId, featureKey, inspectors);
    if (!state) return 'NOT_DRAINING';
    if (state.openItems > 0) return 'STILL_DRAINING';

    const seq = state.disableSeq + 1;
    const commandId = runoffCompletionCommandId(featureKey, state.disableSeq);
    const existing = await tx.entitlementTransition.findUnique({
      where: { companyId_featureKey_commandId: { companyId, featureKey, commandId } },
      select: { seq: true, action: true, actorUserId: true },
    });
    if (existing) {
      // r18 F2 — a row under this id is only PROOF of completion if it IS a completion. Anything
      // else squatting the namespace (a partner command that smuggled the prefix past an older
      // build, a hand-written repair) would otherwise be read as "already done" and the OFF would
      // never land, silently, while the sweep reported the lifecycle finished. Loud, never quiet.
      const isCompletion = existing.action === 'OFF'
        && existing.actorUserId === SYSTEM_ACTOR
        && existing.seq === seq;
      if (!isCompletion) {
        throw new ConflictException({
          code: 'runoff_completion_command_id_squatted',
          message: 'A non-completion transition occupies the runoff completion command id; this lifecycle cannot be completed until it is removed.',
          companyId,
          featureKey,
          commandId,
          found: { seq: existing.seq, action: existing.action, actorUserId: existing.actorUserId },
        });
      }
      return 'ALREADY_COMPLETED';
    }

    const fence = await tx.companyFeatureEntitlement.findUnique({
      where: { companyId_featureKey: { companyId, featureKey } },
      select: { epoch: true },
    });

    await tx.entitlementTransition.create({
      data: {
        companyId,
        featureKey,
        seq,
        // Carried, not bumped: OFF is not an OFF->ON transition (spec:54).
        epoch: fence?.epoch ?? 0,
        commandId,
        action: 'OFF',
        actorUserId: SYSTEM_ACTOR,
        reasonJson: { runoffComplete: true, disableSeq: state.disableSeq, cutoffAt: state.cutoffAt.toISOString() },
      },
    });

    // Advance the fence so the derivation above stops reporting DRAINING. `lastSeq` ONLY — Prisma
    // would stamp `@updatedAt` on a client-side update and silently re-scope the auto-post worker.
    await tx.$executeRaw(Prisma.sql`
      UPDATE "CompanyFeatureEntitlement"
         SET "lastSeq" = ${seq}
       WHERE "companyId" = ${companyId}
         AND "featureKey" = ${featureKey}`);

    // spec:413 — every system action audits actor/system identity, reason, source and transition.
    await tx.auditLog.create({
      data: {
        companyId,
        // `actorUserId` is a real FK to User, so the SYSTEM actor is the actorType, not a literal
        // id — the same shape the normalizer's audit uses. `EntitlementTransition.actorUserId` has
        // no FK and DOES carry the literal (spec:54), which is why the two differ here.
        actorType: 'SYSTEM',
        action: 'system.entitlement.runoff_complete',
        targetType: 'company',
        targetId: companyId,
        requestId: commandId,
        result: 'SUCCESS',
        riskLevel: 'MEDIUM',
        metadataJson: {
          featureKey,
          disableSeq: state.disableSeq,
          offSeq: seq,
          cutoffAt: state.cutoffAt.toISOString(),
          drainingForMs: Date.now() - state.requestedAt.getTime(),
        },
      },
    });

    return 'COMPLETED';
  });
}

/** The reserved prefix. Nothing outside this file may write a transition under it. */
export const RUNOFF_COMPLETION_COMMAND_PREFIX = 'runoff-complete:';
export const RESERVED_COMMAND_ID_CODE = 'reserved_command_id_prefix';

/** Deterministic, cycle-unique, and namespaced — but the namespace only holds if it is ENFORCED. */
export function runoffCompletionCommandId(featureKey: string, disableSeq: number): string {
  return `${RUNOFF_COMPLETION_COMMAND_PREFIX}${featureKey}:${disableSeq}`;
}

/**
 * Refuses a caller-supplied command id inside the completion namespace (codex r18 F2).
 *
 * Command ids are otherwise unrestricted, so a partner disable submitted as
 * `runoff-complete:reports:6` would occupy `@@unique([companyId, featureKey, commandId])` — the very
 * row completion uses as its idempotency fence. Completion would then find a transition under its
 * own id, conclude the work was already done, and the OFF would never land while the sweep counted
 * the lifecycle finished. Reserving the prefix at every external entry point is one half of the fix;
 * `completeRunoffIfDrained` verifying the SHAPE of what it finds is the other.
 */
export function assertCallerCommandId(commandId: string): void {
  if (!commandId.startsWith(RUNOFF_COMPLETION_COMMAND_PREFIX)) return;
  throw new UnprocessableEntityException({
    code: RESERVED_COMMAND_ID_CODE,
    message: `commandId must not start with "${RUNOFF_COMPLETION_COMMAND_PREFIX}" — that namespace belongs to the runoff completer.`,
    commandId,
  });
}

export type DrainingLifecycle = DrainingState & {
  companyId: string;
  /** The DISABLE_REQUESTED transition's id — the keyset cursor for the next page. */
  transitionId: string;
  /**
   * Set when this row's snapshot could not be read. The batch paths surface it as an ERROR and skip
   * the row; they must not take the whole sweep down for every other tenant, and they must never
   * treat it as drained. A DIRECT caller (`completeRunoffIfDrained`) still throws loudly instead.
   */
  readError?: string;
};

/** The ops bound. Clamped at every entry point so a caller cannot ask for an unbounded scan. */
export const MAX_DRAINING_PAGE = 200;
export const clampDrainingLimit = (limit: unknown): number => {
  const value = Math.trunc(Number(limit));
  return Number.isFinite(value) && value >= 1 ? Math.min(value, MAX_DRAINING_PAGE) : MAX_DRAINING_PAGE;
};

/** A live DISABLE_REQUESTED row, as the keyset query returns it. */
type LiveDrainRow = { id: string; companyId: string; featureKey: string; seq: number; createdAt: Date };

export const INVALID_CURSOR_CODE = 'invalid_runoff_cursor';

/**
 * The opaque continuation token: base64 of `<createdAt ISO>:<transition id>`.
 *
 * It carries BOTH keyset columns precisely so resuming never has to look the row up again — see
 * `selectLiveDrains`. Opaque so callers cannot hand-craft one and cannot come to depend on the
 * ordering columns, which are an implementation detail of the page.
 */
export function encodeDrainCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}:${id}`, 'utf8').toString('base64url');
}

/** Decodes a cursor, or throws a 422. `null`/absent means "start at the beginning". */
export function decodeDrainCursor(cursor?: string | null): { createdAt: Date; id: string } | null {
  if (cursor === undefined || cursor === null || cursor === '') return null;
  const invalid = () => new UnprocessableEntityException({
    code: INVALID_CURSOR_CODE,
    message: 'cursorId is not a cursor this endpoint issued. Omit it to start from the beginning.',
  });
  if (typeof cursor !== 'string') throw invalid();
  let decoded: string;
  try {
    decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  } catch {
    throw invalid();
  }
  // Node's base64url decoder is LENIENT: it silently drops invalid characters, so `cursor + '!'`
  // or trailing padding decodes to the same tuple and a corrupted token would be accepted instead
  // of 422'd. Canonical round-trip equality is the strictness the decoder itself refuses to provide.
  if (Buffer.from(decoded, 'utf8').toString('base64url') !== cursor) throw invalid();
  // The id is a cuid and never contains ':', so splitting at the LAST colon is unambiguous even
  // though the ISO timestamp contains several.
  const split = decoded.lastIndexOf(':');
  if (split <= 0) throw invalid();
  const createdAt = new Date(decoded.slice(0, split));
  const id = decoded.slice(split + 1);
  if (Number.isNaN(createdAt.getTime()) || id === '') throw invalid();
  return { createdAt, id };
}

/**
 * THE live-drain predicate, evaluated IN THE DATABASE (r19-1).
 *
 * A drain is live when its DISABLE_REQUESTED transition is still the entitlement row's `lastSeq` —
 * a comparison BETWEEN TWO COLUMNS OF DIFFERENT TABLES, which Prisma's query builder cannot express,
 * so this is raw SQL by necessity rather than preference.
 *
 * Filtering in the database is not an optimisation here, it is a correctness fix: bounding the
 * CANDIDATE rows and filtering afterwards meant 200 completed historical requests ahead of one live
 * drain produced a page of zero live rows, and the sweep re-read that same dead page forever while
 * the real drain was never examined.
 *
 * Keyset pagination on `(createdAt, id)` — oldest first, so a steady stream of new drains cannot
 * starve an old stuck one, and a row that legitimately never completes (STILL_DRAINING) cannot block
 * the rows behind it: the caller carries `nextCursorId` past it.
 */
async function selectLiveDrains(
  prisma: PrismaService,
  take: number,
  cursor?: string | null,
): Promise<LiveDrainRow[]> {
  const position = decodeDrainCursor(cursor);
  // The keyset values are BOUND DIRECTLY — never looked up from a subquery. An id-only cursor had
  // to resolve `(createdAt, id)` via `SELECT … WHERE id = $cursor`, and if that transition had since
  // been deleted the subquery returned no row, the tuple comparison went NULL for EVERY candidate,
  // and the page came back empty — a silent terminal that hid every live drain behind it.
  const keyset = position
    ? Prisma.sql`AND (t."createdAt", t."id") > (${position.createdAt}::timestamptz, ${position.id}::text)`
    : Prisma.empty;
  return prisma.client.$queryRaw<LiveDrainRow[]>(Prisma.sql`
    SELECT t."id", t."companyId", t."featureKey", t."seq", t."createdAt"
      FROM "EntitlementTransition" t
      JOIN "CompanyFeatureEntitlement" e
        ON e."companyId" = t."companyId" AND e."featureKey" = t."featureKey"
     WHERE t."action" = 'DISABLE_REQUESTED'
       AND e."lastSeq" = t."seq"
       ${keyset}
     ORDER BY t."createdAt" ASC, t."id" ASC
     LIMIT ${take}
  `);
}

/** Attaches each live drain's immutable snapshot. Shared by the ops page and the health aggregate. */
async function resolveDrains(
  prisma: PrismaService,
  live: LiveDrainRow[],
  inspectors: RunoffCompletionInspectors,
  deadlineAt?: number,
): Promise<DrainingLifecycle[]> {
  if (live.length === 0) return [];
  const snapshots = await prisma.client.runoffSnapshot.findMany({
    where: { OR: live.map((row) => ({ companyId: row.companyId, featureKey: row.featureKey, disableSeq: row.seq })) },
    select: { companyId: true, featureKey: true, disableSeq: true, cutoffAt: true, rootsJson: true },
  });
  const snapshotByKey = new Map(snapshots.map((row) => [`${row.companyId} ${row.featureKey} ${row.disableSeq}`, row]));

  const resolved: DrainingLifecycle[] = [];
  for (const row of live) {
    if (deadlineAt !== undefined && Date.now() >= deadlineAt) break;
    const snapshot = snapshotByKey.get(`${row.companyId} ${row.featureKey} ${row.seq}`);
    const base = {
      transitionId: row.id,
      companyId: row.companyId,
      featureKey: row.featureKey,
      disableSeq: row.seq,
      cutoffAt: snapshot?.cutoffAt ?? row.createdAt,
      requestedAt: row.createdAt,
    };
    // A DISABLE_REQUESTED with no snapshot is a broken drain, not a drained one (both are written
    // in one transaction, so it is unreachable) — never "0 open items".
    if (!snapshot) {
      resolved.push({ ...base, openItems: Number.POSITIVE_INFINITY, readError: 'snapshot missing' });
      continue;
    }
    try {
      const roots = plainRecord(snapshot.rootsJson) && Array.isArray(snapshot.rootsJson.roots)
        ? snapshot.rootsJson.roots
        : null;
      const input = {
        companyId: row.companyId,
        featureKey: row.featureKey,
        disableSeq: row.seq,
        cutoffAt: snapshot.cutoffAt,
        rootsJson: snapshot.rootsJson,
      };
      const openItems = roots && roots.length > 0
        ? await prisma.client.$transaction(async (tx) => {
          await boundInspectionTransaction(tx);
          return inspectOpenRunoffItems(tx, input, inspectors);
        })
        : await inspectOpenRunoffItems(prisma.client, input, inspectors);
      resolved.push({
        ...base,
        openItems,
      });
    } catch (error) {
      // Caught per ROW, not per page: one unreadable snapshot must not stop the sweep for every
      // other tenant, and must not be silently counted as drained either. It becomes an error the
      // sweep reports and R5 can act on.
      resolved.push({ ...base, openItems: Number.POSITIVE_INFINITY, readError: (error as Error).message });
    }
  }
  return resolved;
}

export type DrainingPage = {
  lifecycles: DrainingLifecycle[];
  /** OPAQUE continuation token — pass it back as `cursorId`. Never parse it. */
  nextCursorId: string | null;
};

/**
 * A BOUNDED page of currently draining lifecycles, for the ops sweep and the R5 listing.
 *
 * `nextCursorId` is non-null whenever the page came back full, so a caller can continue past rows
 * that will never complete. NOT for the health view — a page can under-count; use
 * `aggregateDrainingByFeature` there.
 */
export async function listDrainingPage(
  prisma: PrismaService,
  limit: number = MAX_DRAINING_PAGE,
  cursorId?: string | null,
  inspectors: RunoffCompletionInspectors = NO_RUNOFF_COMPLETION_INSPECTORS,
): Promise<DrainingPage> {
  const take = clampDrainingLimit(limit);
  const live = await selectLiveDrains(prisma, take, cursorId);
  const lifecycles = await resolveDrains(prisma, live, inspectors);
  const last = live[live.length - 1];
  return {
    lifecycles,
    // Only when the page was full: a short page means the predicate is exhausted, and handing back
    // a cursor there would invite an extra round trip that can only return nothing.
    nextCursorId: live.length === take && last ? encodeDrainCursor(last.createdAt, last.id) : null,
  };
}

/** The lifecycles alone, for callers that do not page. */
export async function listDrainingLifecycles(
  prisma: PrismaService,
  limit: number = MAX_DRAINING_PAGE,
  cursorId?: string | null,
  inspectors: RunoffCompletionInspectors = NO_RUNOFF_COMPLETION_INSPECTORS,
): Promise<DrainingLifecycle[]> {
  return (await listDrainingPage(prisma, limit, cursorId, inspectors)).lifecycles;
}

export type DrainingFeatureAggregate = {
  companies: number;
  openItems: number;
  oldestRequestedAt: Date;
  inspectionErrors: number;
  inspectionTruncated: boolean;
};

type DrainingAggregateRow = { featureKey: string; companies: bigint | number; oldestRequestedAt: Date };

/**
 * The exact-count, bounded-inspection per-feature drain aggregate the health view reports from.
 *
 * The bounded page above is wrong here: at one drain past the page size a draining company would be
 * silently counted OFF and the true oldest drain could fall outside the window. Counts and age are
 * therefore aggregated over every live drain in SQL, while domain inspection has both a row cap and
 * a wall-clock budget. Anything beyond either boundary is explicit inspection-unknown, never zero.
 */
export async function aggregateDrainingByFeature(
  prisma: PrismaService,
  inspectors: RunoffCompletionInspectors = NO_RUNOFF_COMPLETION_INSPECTORS,
): Promise<Map<string, DrainingFeatureAggregate>> {
  // Counts/age remain exact in SQL. Only per-company inspection is bounded; overflow is explicitly
  // unknown for that feature rather than under-counted or reported as zero open work.
  const totals = await prisma.client.$queryRaw<DrainingAggregateRow[]>(Prisma.sql`
    SELECT t."featureKey", COUNT(*) AS "companies", MIN(t."createdAt") AS "oldestRequestedAt"
      FROM "EntitlementTransition" t
      JOIN "CompanyFeatureEntitlement" e
        ON e."companyId" = t."companyId" AND e."featureKey" = t."featureKey"
     WHERE t."action" = 'DISABLE_REQUESTED'
       AND e."lastSeq" = t."seq"
     GROUP BY t."featureKey"
  `);
  const live = await prisma.client.$queryRaw<LiveDrainRow[]>(Prisma.sql`
    SELECT t."id", t."companyId", t."featureKey", t."seq", t."createdAt"
      FROM "EntitlementTransition" t
      JOIN "CompanyFeatureEntitlement" e
        ON e."companyId" = t."companyId" AND e."featureKey" = t."featureKey"
     WHERE t."action" = 'DISABLE_REQUESTED'
       AND e."lastSeq" = t."seq"
     ORDER BY t."createdAt" ASC, t."id" ASC
     LIMIT ${MAX_DRAINING_HEALTH_INSPECTIONS}
  `);
  const byFeature = new Map<string, DrainingFeatureAggregate>(totals.map((row) => {
    const companies = Number(row.companies);
    if (!Number.isSafeInteger(companies) || companies < 0) {
      throw new Error(`runoff_health_count_invalid: ${row.featureKey}/${String(row.companies)}`);
    }
    return [row.featureKey, {
      companies,
      openItems: 0,
      oldestRequestedAt: row.oldestRequestedAt,
      inspectionErrors: 0,
      inspectionTruncated: false,
    }];
  }));
  const inspectedByFeature = new Map<string, number>();
  for (const row of await resolveDrains(
    prisma,
    live,
    inspectors,
    Date.now() + RUNOFF_HEALTH_INSPECTION_BUDGET_MS,
  )) {
    const entry = byFeature.get(row.featureKey)
      ?? { companies: 1, openItems: 0, oldestRequestedAt: row.requestedAt, inspectionErrors: 0, inspectionTruncated: false };
    inspectedByFeature.set(row.featureKey, (inspectedByFeature.get(row.featureKey) ?? 0) + 1);
    if (Number.isFinite(row.openItems)) entry.openItems += row.openItems;
    else entry.inspectionErrors += 1;
    byFeature.set(row.featureKey, entry);
  }
  for (const [featureKey, entry] of byFeature) {
    const uninspected = Math.max(entry.companies - (inspectedByFeature.get(featureKey) ?? 0), 0);
    entry.inspectionErrors += uninspected;
    entry.inspectionTruncated = uninspected > 0;
  }
  return byFeature;
}

export type RunoffSweepResult = {
  examined: number;
  completed: number;
  stillDraining: number;
  errors: number;
  /**
   * Non-null when more live drains may follow this page. Pass it back as `cursorId` to continue.
   * This is what stops a row that never completes (a STILL_DRAINING family, or one whose completion
   * errors) from permanently starving every row behind it — without it the sweep re-reads the same
   * blocked page forever.
   */
  nextCursorId: string | null;
};

/**
 * The runoff reconciler (spec:69: "repairs missed completion events and alerts on DRAINING age";
 * runbook R5). It NEVER widens snapshot membership — it only re-asks the derivation and appends OFF
 * where the drain is finished.
 *
 * Its real job in this slice is the crash window: the partner command completes an empty drain
 * post-commit, and a process death in that gap is exactly the "missed completion event" this
 * repairs. Schedulerless by ruling OQ-7 — the internal endpoint gives R5 a real action and cadence
 * is an ops item.
 */
export async function sweepDrainingLifecycles(
  prisma: PrismaService,
  limit: number = MAX_DRAINING_PAGE,
  cursorId?: string | null,
  inspectors: RunoffCompletionInspectors = NO_RUNOFF_COMPLETION_INSPECTORS,
): Promise<RunoffSweepResult> {
  const page = await listDrainingPage(prisma, limit, cursorId, inspectors);
  const result: RunoffSweepResult = {
    examined: page.lifecycles.length,
    completed: 0,
    stillDraining: 0,
    errors: 0,
    nextCursorId: page.nextCursorId,
  };
  for (const lifecycle of page.lifecycles) {
    if (lifecycle.readError) {
      // Never attempt completion on a row whose snapshot could not be read.
      result.errors += 1;
      continue;
    }
    try {
      const outcome = await completeRunoffIfDrained(prisma, lifecycle.companyId, lifecycle.featureKey, inspectors);
      if (outcome === 'COMPLETED' || outcome === 'ALREADY_COMPLETED') result.completed += 1;
      else if (outcome === 'STILL_DRAINING') result.stillDraining += 1;
    } catch {
      // One stuck lifecycle must not stop the sweep for every other tenant.
      result.errors += 1;
    }
  }
  return result;
}
