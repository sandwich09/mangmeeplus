/**
 * F2 / CC7 (spec:232-238) — deploy-owned LEGACY entitlement normalization.
 *
 * Why this exists: F1.5.1 closed every partner entitlement command while
 * `CompanyEntitlementNormalization` is absent or not COMPLETED, and only NEW-company onboarding
 * writes COMPLETED. Without this pass, the first deploy leaves every EXISTING company's package
 * screen permanently read-only. Zero user interaction — no wizard, no re-entry, no notification.
 *
 * Lifecycle (UAT r5 ruling 3): the writer is NOT a fixture of every deploy. A generic release runs
 * `--dry-run`, which computes the plan and emits a reviewable artifact and writes nothing; the
 * one-time APPLY is armed by `F2_APPLY=true` for the single coordinated release, and `--verify`
 * re-checks the result afterwards. `prisma/normalize-entitlements.ts` owns that mode selection.
 *
 * The rule the whole file obeys: **effective access must not change.** The stored rows are made to
 * say exactly what the runtime already answers, so that when the legacy fail-open / DEFAULT_ON /
 * inheritance / submenu semantics are finally removed (day 14 + 7 clean days, spec:237) nothing
 * flips. Every effective value comes from THE canonical evaluator (`evaluateEntitledFeatureKeys`) —
 * never a fork of its rules.
 *
 * Deliberately NOT rewritten: a row whose stored value already equals its effective value. Rewriting
 * it would restamp `updatedAt`, and `expense_auto_post`'s `updatedAt` is the auto-post worker's
 * activation cutoff (ledger/application/use-cases/expense-auto-post.use-case.ts:94) — a restamp
 * would silently re-scope which expenses the worker considers. Skipping identical rows is applied
 * to every key, not just that one. Such a row still receives `grantOrigin=LEGACY`, through a raw
 * SQL UPDATE that touches that one column and leaves `updatedAt` alone.
 */
import { createHash } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import {
  ALL_FEATURE_ENTITLEMENT_KEYS,
  PLATFORM_INVARIANT_FEATURE_KEYS,
  parentFeatureKey,
  unmetFeatureDependencies,
} from '@watchdog-bms/contracts';
import { Prisma } from '../../../generated/prisma/client';
import type { PrismaService } from '../../../common/database/prisma.service';
import { exclusiveEntitlementLock } from '../../feature-launch/application/execution-attempt.service';
import { evaluateEntitledFeatureKeys, type StoredEntitlementRow } from './entitlement.helper';

/** CC7 (spec:235) — the durable grandfather-cohort marker. No expiry. */
export const LEGACY_GRANT_ORIGIN = 'LEGACY';
/**
 * UAT r7 — the DURABLE cohort, recorded on `CompanyEntitlementNormalization.cohortKind` at
 * completion. Verify reads this instead of inferring "grandfathered" from "some row carries
 * grantOrigin=LEGACY": that inference reads a legacy company whose stamp landed on ZERO rows as
 * EXPLICIT, so a company missing its entire cohort marker passed the deploy gate.
 */
export const LEGACY_COHORT = 'LEGACY';
export const EXPLICIT_COHORT = 'EXPLICIT';
/**
 * UAT r8 A3 — the CLOSED set of cohort values. `cohortKind` is a plain `String?` column (Prisma
 * cannot express a CHECK, so migration `20260803160000_cohort_kind_check` adds one in raw SQL), and
 * before this every reader treated "not LEGACY" as EXPLICIT — so a typo, a hand-run UPDATE or a
 * future value would silently downgrade a grandfathered company to "no provenance required".
 * Writers validate with this; verify reports anything outside it as INCOMPLETE/INVALID.
 */
export const COHORT_KINDS = [LEGACY_COHORT, EXPLICIT_COHORT] as const;
export type CohortKind = (typeof COHORT_KINDS)[number];
export const COHORT_EVIDENCE = [
  'FIRST_NORMALIZATION_RULE',
  'EXISTING_MARKER',
  'LEGACY_NORMALIZATION_AUDIT',
  'COMPANY_ONBOARDING_RUN',
  'UNRESOLVED',
] as const;
export type CohortEvidence = (typeof COHORT_EVIDENCE)[number];
export function isCohortKind(value: string | null | undefined): value is CohortKind {
  return value === LEGACY_COHORT || value === EXPLICIT_COHORT;
}
/**
 * The repair generation. Stored on the marker row; the runner re-opens any COMPLETED company whose
 * marker is BELOW this number, so a corrected rule is re-applied to companies already normalized by
 * an older pass. Raise it in the same commit as the rule change — never silently.
 *
 * 1 (UAT r7): every marker written before `cohortKind` existed carries null, and null is not a
 * cohort — it is the absence of the evidence verify now requires. Raising the generation re-opens
 * all of them so the value is WRITTEN rather than backfilled by guess.
 */
export const NORMALIZER_VERSION = 1;
/**
 * UAT r7 P0-4 — an apply is bound to per-company plan hashes from ONE reviewed artifact, so a
 * company whose plan moved after the review is a permanent failure for this run, never a retry
 * with a plan no human saw. Carried as a distinct type because the runner's ordinary
 * retry-once-then-fail loop must not treat it as transient.
 */
export class UnapprovedPlanError extends Error {
  constructor(readonly companyId: string, readonly approvedHash: string, readonly actualHash: string) {
    super(
      `entitlement_normalization_plan_not_approved: the plan for ${companyId} is not the one that was `
      + `approved (approved=${approvedHash} recomputed=${actualHash}). Nothing was written for this company.`,
    );
  }
}
/** The value an approved-plan map carries for a company whose PLAN itself crashed. Never appliable. */
export const PLAN_FAILED = 'PLAN_FAILED';
/**
 * Ruling 4b — a dependency the normalizer refuses to resolve on its own. The company is left
 * untouched and NOT COMPLETED, and support resolves it. Recorded on `CompanyEntitlementNormalization.error`.
 */
export const ENTITLEMENT_DEPENDENCY_EXCEPTION = 'entitlement_dependency_exception';
/**
 * `EntitlementTransition.actorUserId` is a free String; `AuditLog.actorUserId` is a real FK.
 *
 * Exported because it is a CONTRACT, not a local constant: this literal is what separates a machine
 * pass from a human decision on the append-only transition log (see `humanDecidedKeys`), so every
 * reader of that distinction must compare against the same value.
 */
export const SYSTEM_ACTOR = 'SYSTEM';
/**
 * S-9 — `expense_auto_post` never goes through the evaluator: both drain paths query the row
 * directly with `enabled: true`, so a fail-open (zero-row) company is NOT auto-posting today.
 * Materializing it from fail-open would START posting journals nobody asked for, which is why the
 * legacy implicit value is ALWAYS OFF and only an already-explicit `true` survives.
 */
const AUTO_POST_KEY = 'expense_auto_post';

const CANONICAL_KEYS: readonly string[] = [...ALL_FEATURE_ENTITLEMENT_KEYS].sort();
const CANONICAL_KEY_SET = new Set(CANONICAL_KEYS);

/** Why a row is being written. Recorded in the audit so a cohort can be reconstructed later. */
export type NormalizationWriteReason =
  | 'MATERIALIZED_IMPLICIT'
  | 'AUTO_POST_IMPLICIT_OFF'
  | 'PLATFORM_INVARIANT_HEAL'
  | 'PARENT_MASK'
  | 'DEPENDENCY_MASK';

export type NormalizationWrite = {
  featureKey: string;
  fromEnabled: boolean;
  toEnabled: boolean;
  reason: NormalizationWriteReason;
};

/**
 * An unmet `FEATURE_DEPENDENCIES` edge (spec:264) found in the EFFECTIVE set. `MASKED_OFF` is
 * resolved by the plan itself; `EXCEPTION` is handed to support and blocks the company.
 */
export type DependencyFinding = {
  featureKey: string;
  requiresFeatureKey: string;
  action: 'MASKED_OFF' | 'EXCEPTION';
};

export type NormalizationPlan = {
  companyId: string;
  /** The cohort whose marker/provenance mutations this plan hash authorizes. */
  cohortKind: CohortKind | null;
  /** The deterministic FINAL state: one entry per canonical key, sorted. */
  proposedRows: Array<{ featureKey: string; enabled: boolean }>;
  /** The subset that is actually persisted. Identical rows are absent by design. */
  writes: NormalizationWrite[];
  /** Rows with a featureKey outside the canonical catalog: snapshotted, then deleted. */
  orphanRows: Array<{ featureKey: string; enabled: boolean }>;
  /** Every unmet dependency edge, in canonical order. `EXCEPTION` entries block the company. */
  dependencyFindings: DependencyFinding[];
  /**
   * UAT r6 — the keys the provenance pass stamps `grantOrigin=LEGACY` on (the raw-SQL UPDATE
   * below). It is a real mutation, so it belongs in the plan and in the hash: without it the
   * artifact under-reports what an apply changes, because a company whose stored values already
   * agree with the evaluator has zero `writes` and still gets every ON row re-labelled.
   */
  provenanceKeys: string[];
  /** sha256 over the whole plan. Recomputed under the lock; a mismatch is a safe retry. */
  hash: string;
};

/** The support-visible sentence recorded on the marker row and printed by the release task. */
export function dependencyExceptionMessage(findings: readonly DependencyFinding[]): string {
  return `${ENTITLEMENT_DEPENDENCY_EXCEPTION}: ${findings
    .map((finding) => `${finding.featureKey} requires ${finding.requiresFeatureKey}`)
    .join('; ')}`;
}

/**
 * Consumption semantics, not raw evaluator membership. `filterPermissionsByEntitlement`
 * (feature-gate.logic.ts:80) drops a submenu permission when EITHER the submenu or its parent is
 * missing, so an explicit `true` submenu under an OFF parent is already unusable. Storing it as
 * `false` is what keeps behaviour identical once legacy semantics are removed.
 */
function effectiveOf(entitled: ReadonlySet<string> | null, explicit: ReadonlyMap<string, boolean>, key: string): boolean {
  if (key === AUTO_POST_KEY) return explicit.get(key) === true;
  if (entitled === null) return true; // zero rows = legacy fail-open = every feature is on
  const parent = parentFeatureKey(key);
  return entitled.has(key) && (parent === key || entitled.has(parent));
}

function writeReasonOf(
  key: string,
  stored: boolean | undefined,
  toEnabled: boolean,
  masked: boolean,
): NormalizationWriteReason {
  if (masked) return 'DEPENDENCY_MASK';
  if (stored === undefined) return key === AUTO_POST_KEY && !toEnabled ? 'AUTO_POST_IMPLICIT_OFF' : 'MATERIALIZED_IMPLICIT';
  return PLATFORM_INVARIANT_FEATURE_KEYS.includes(key) ? 'PLATFORM_INVARIANT_HEAL' : 'PARENT_MASK';
}

/**
 * Ruling 4 — the ONE contracts-owned dependency matrix (spec:264), applied to the EFFECTIVE set
 * rather than to the stored rows, because a legacy company's stored rows are exactly what does not
 * agree with runtime yet.
 *
 * `expense_auto_post` without `double_entry_ledger` is masked OFF automatically, and the ledger is
 * NEVER auto-enabled to satisfy it: the auto-post worker treats the entitlement row's `updatedAt`
 * as its activation cutoff (ledger/application/use-cases/expense-auto-post.use-case.ts:94), so
 * granting the ledger while leaving a stale cutoff in place would backfill-post every old expense
 * the moment the drain runs. Masking is the only direction that cannot post a journal nobody asked
 * for. It writes an ON→OFF row, so no epoch moves.
 *
 * The procurement children have no such safe direction — turning them off removes access somebody
 * may be using, turning `vendor_bills` on grants access nobody bought — so they are never silently
 * fixed. They become an EXCEPTION: the company is left untouched and stays NOT COMPLETED.
 */
function dependencyFindingsOf(effective: (featureKey: string) => boolean): DependencyFinding[] {
  return unmetFeatureDependencies(effective).map((violation) => ({
    ...violation,
    action: violation.featureKey === AUTO_POST_KEY ? ('MASKED_OFF' as const) : ('EXCEPTION' as const),
  }));
}

/**
 * Pure, deterministic: the same stored rows always produce the same plan and the same hash.
 * This is the dry-run, and it is re-run verbatim under the lock before anything is written.
 *
 * `humanDecided` (UAT r8) is `humanDecidedKeys` for this company. It is a REQUIRED argument, not a
 * defaulted one, because forgetting it is not a missing optimisation — it is a plan that proposes to
 * stamp a human's decision as grandfathered. Pass an explicitly empty set when there is provably
 * nothing decided (a pure unit fixture); everything reading a database loads it.
 */
export function planCompanyNormalization(
  companyId: string,
  rows: readonly StoredEntitlementRow[],
  cohortKind: CohortKind | null,
  humanDecided: ReadonlySet<string>,
): NormalizationPlan {
  const isLegacyCohort = cohortKind === LEGACY_COHORT;
  const explicit = new Map(rows.map((row) => [row.featureKey, row.enabled]));
  // Always-on keys with an explicit `false` are a legacy anomaly (spec:262): the partner command
  // now refuses to WRITE one, and CC7 owns healing the rows that already exist. Heal the INPUT so
  // the one canonical evaluator also re-enables their submenus — a parent switched back on with
  // every submenu still masked off would leave a company unable to see its own employees.
  const healedRows: StoredEntitlementRow[] = rows.map((row) => (
    PLATFORM_INVARIANT_FEATURE_KEYS.includes(row.featureKey) ? { ...row, enabled: true } : row
  ));
  const entitled = evaluateEntitledFeatureKeys(healedRows);
  // The BEFORE state is read from the untouched rows, so the audit tells the truth about the heal.
  const before = evaluateEntitledFeatureKeys(rows);

  const dependencyFindings = dependencyFindingsOf((key) => effectiveOf(entitled, explicit, key));
  const maskedOff = new Set(
    dependencyFindings.filter((finding) => finding.action === 'MASKED_OFF').map((finding) => finding.featureKey),
  );

  const proposedRows = CANONICAL_KEYS.map((featureKey) => ({
    featureKey,
    enabled: !maskedOff.has(featureKey) && effectiveOf(entitled, explicit, featureKey),
  }));
  const writes: NormalizationWrite[] = proposedRows
    .filter((row) => explicit.get(row.featureKey) !== row.enabled)
    .map((row) => ({
      featureKey: row.featureKey,
      fromEnabled: effectiveOf(before, explicit, row.featureKey),
      toEnabled: row.enabled,
      reason: writeReasonOf(row.featureKey, explicit.get(row.featureKey), row.enabled, maskedOff.has(row.featureKey)),
    }));
  const orphanRows = rows
    .filter((row) => !CANONICAL_KEY_SET.has(row.featureKey))
    .map((row) => ({ featureKey: row.featureKey, enabled: row.enabled }))
    .sort((a, b) => a.featureKey.localeCompare(b.featureKey));

  /**
   * UAT r8 — every effective-ON row of a LEGACY company EXCEPT the keys a human has decided.
   *
   * The exclusion is the owner ruling made durable: "the moment an operator decides a row it is an
   * EXPLICIT grant", and an explicit command clears the marker. Stamping the whole ON set would let
   * the next `NORMALIZER_VERSION` bump silently revert that — manufacturing grandfather evidence on
   * a row a human decided, which is the exact claim `grantOrigin` is consulted for on day 14.
   *
   * It lives HERE, in the plan, and not at write time: `provenanceKeys` is in the hash below, so a
   * write-time filter would make the reviewed artifact describe a mutation the apply does not
   * perform, and PLAN, APPLY and VERIFY would each answer a different question.
   */
  const provenanceKeys = isLegacyCohort
    ? proposedRows.filter((row) => row.enabled && !humanDecided.has(row.featureKey)).map((row) => row.featureKey)
    : [];

  // UAT r6 — the hash covers EVERY mutation an apply performs plus the generation that produced it:
  // values (`writes`), provenance (`provenanceKeys`), orphan removal, the dependency verdicts that
  // decide whether a company completes at all, and `normalizerVersion` — so a rule change that
  // raises the generation cannot reuse an approval granted against the old rules.
  const hash = createHash('sha256')
    .update(JSON.stringify({
      companyId,
      cohortKind,
      normalizerVersion: NORMALIZER_VERSION,
      rows: proposedRows.map((row) => [row.featureKey, row.enabled]),
      writes: writes.map((write) => [write.featureKey, write.fromEnabled, write.toEnabled]),
      orphans: orphanRows.map((row) => [row.featureKey, row.enabled]),
      dependencies: dependencyFindings.map((finding) => [finding.featureKey, finding.requiresFeatureKey, finding.action]),
      provenance: provenanceKeys,
    }))
    .digest('hex');

  return { companyId, cohortKind, proposedRows, writes, orphanRows, dependencyFindings, provenanceKeys, hash };
}

/**
 * UAT r6 — the ONE number a human approves. Canonical over the WHOLE run: company membership and
 * every per-company plan hash, sorted by company id because the bounded-concurrency runner produces
 * results in completion order. Apply recomputes it and refuses to write when it differs from the
 * approved value, so an artifact reviewed at 09:00 cannot authorize a mutation the data no longer
 * describes at 11:00 — a company that appeared, disappeared, or changed shifts this number.
 */
export function aggregateNormalizationHash(
  companies: readonly Pick<NormalizeCompanyResult, 'companyId' | 'hash'>[],
): string {
  return createHash('sha256')
    .update(JSON.stringify({
      artifact: 'f2-entitlement-normalization',
      normalizerVersion: NORMALIZER_VERSION,
      companies: companies
        .map((company) => [company.companyId, company.hash])
        .sort((a, b) => a[0]!.localeCompare(b[0]!)),
    }))
    .digest('hex');
}

export type NormalizeCompanyOptions = {
  /** Identifies one normalization pass across every company. Stored on the marker row. */
  runId: string;
  /** Compute and hash only. Nothing is locked, nothing is written. */
  dryRun?: boolean;
  /**
   * UAT r7 P0-4 — the per-company hash a human approved. When set, the plan is checked against it
   * BEFORE the lock and again under it, and any difference throws `UnapprovedPlanError` instead of
   * writing. The aggregate preflight cannot cover this: it is recomputed on a fresh read seconds
   * earlier, so a company that moves in between would otherwise be re-planned and applied unseen.
   */
  expectedPlanHash?: string;
};

export type NormalizeCompanyResult = {
  companyId: string;
  /** `EXCEPTION` = a dependency only support can resolve; nothing was written and the gate blocks. */
  status: 'COMPLETED' | 'ALREADY_COMPLETED' | 'DRY_RUN' | 'EXCEPTION' | 'UNRESOLVED_COHORT';
  cohortKind: CohortKind | null;
  cohortEvidence: CohortEvidence;
  hash: string;
  /** Rows persisted (0 on a dry run / no-op). */
  written: number;
  /** Canonical rows the plan deliberately left byte-untouched. */
  unchanged: number;
  removed: number;
  /** Exact non-canonical rows covered by the plan hash; review before removal. */
  orphanRows: Array<{ featureKey: string; enabled: boolean }>;
  setVersion: number | null;
  /** Rows stamped `grantOrigin=LEGACY` — a mutation `writes` does not report (UAT r6). */
  provenance: number;
  /** The per-key before/after diff, for the release-task artifact. Empty on a no-op. */
  writes: NormalizationWrite[];
  dependencyFindings: DependencyFinding[];
};

/** Satisfied by both the root client and a transaction client. */
type EntitlementReader = Pick<PrismaService['client'], 'companyFeatureEntitlement'>;

async function loadRows(client: EntitlementReader, companyId: string) {
  return client.companyFeatureEntitlement.findMany({
    where: { companyId },
    // `grantOrigin` is read for the verify pass's provenance check (UAT r6); the planner ignores it.
    select: { featureKey: true, enabled: true, epoch: true, lastSeq: true, grantOrigin: true },
    orderBy: { featureKey: 'asc' },
  });
}

/**
 * UAT r8 — THE set of feature keys a human has decided on this company, for all time.
 *
 * The contract: `EntitlementTransition.actorUserId` is the literal `SYSTEM` for machine passes (the
 * normalizer, spec:51) and a REAL user id for every human decision — `SetPartnerFeaturesUseCase`
 * and `EntitlementExceptionUseCase` both write `requestingAdminUserId`, including on a partner
 * confirm that moves no value (`reasonJson.noopConfirm`, whose whole purpose is to leave this
 * evidence). So `actorUserId != 'SYSTEM'` IS the record of a human decision.
 *
 * Deliberately UNBOUNDED IN TIME. The exemption used to be "a transition later than the marker's
 * `completedAt`", and every pass rewrites `completedAt` — so each repair silently narrowed the
 * window to nothing and the operator's decision expired. `EntitlementTransition` is append-only:
 * once a human has decided a key, no later pass can un-decide it, and neither the provenance stamp
 * nor the verify check may pretend otherwise.
 *
 * Ordering: partner commands are refused until normalization has COMPLETED, so a human transition
 * can never predate a company's first normalization. The exception resolver is the one writer that
 * runs before it, and its decisions are exactly the ones that must survive the pass that follows.
 */
export async function humanDecidedKeys(
  client: Pick<PrismaService['client'], 'entitlementTransition'>,
  companyId: string,
): Promise<Set<string>> {
  const decided = await client.entitlementTransition.findMany({
    where: { companyId, actorUserId: { not: SYSTEM_ACTOR } },
    select: { featureKey: true },
    distinct: ['featureKey'],
  });
  return new Set(decided.map((transition) => transition.featureKey));
}

/**
 * UAT r8 A2 — the cohort of the company this pass is about to write, from DURABLE evidence only.
 *
 * `null` used to be resolved by looking at the rows (`rows.some(grantOrigin = LEGACY)`), which reads
 * a legacy company whose provenance UPDATE never ran as EXPLICIT — the dangerous default, since
 * EXPLICIT is the cohort that demands no grandfather stamp at all. Nothing about a row is evidence
 * of a cohort; only a record written in the SAME transaction as a marker is:
 *
 *   LEGACY   — an `AuditLog` `system.entitlement.normalize` row whose metadata says that pass ran as
 *              the grandfather cohort. The normalizer writes it in the marker's own transaction, so
 *              it cannot exist without the pass having happened, and it survives every row rewrite.
 *   EXPLICIT — a `CompanyOnboardingRun` row: onboarding writes the run, the entitlement rows and the
 *              marker in ONE transaction (create-company-onboarding.use-case.ts:189), and it is the
 *              only other writer of a COMPLETED marker.
 *   null     — no evidence. NOT a guess: the company completes normally, its marker records no
 *              cohort, and `verifyCompanyNormalizations` reports it INCOMPLETE so the day-14 removal
 *              of legacy semantics stays blocked until a human decides. External r9 — it also stays
 *              PENDING, so every later pass re-plans it (idempotently, zero writes) and a cohort that
 *              becomes derivable later needs no operator action at all.
 *              HEAL PATH: establish the cohort from the customer's contract/onboarding record, then
 *              ONE statement — `UPDATE "CompanyEntitlementNormalization" SET "cohortKind" =
 *              'LEGACY'|'EXPLICIT', "status" = 'STARTED', "completedAt" = NULL` — and let the next
 *              PLAN/APPLY finish it; `--verify` then goes green. The reopen is part of the heal, not
 *              optional: recording the cohort is exactly what takes the company OUT of the pending
 *              set, and a LEGACY company still needs the pass that stamps `grantOrigin` on its
 *              effective-ON rows, which is what verify demands of that cohort.
 *
 * LEGACY is checked first: it is the conservative answer, because it is the one that makes verify
 * DEMAND the grandfather stamp rather than waive it.
 */
type CohortEvidenceReader = Pick<PrismaService['client'], 'auditLog' | 'companyOnboardingRun'>;
type CohortResolution = { cohortKind: CohortKind | null; cohortEvidence: CohortEvidence };

async function cohortResolutionOf(
  client: CohortEvidenceReader,
  companyId: string,
  existingMarker: { cohortKind: string | null } | null,
): Promise<CohortResolution> {
  // No marker at all is the ONE thing that means "first-ever normalization". Any marker, in any
  // status, means this company was seen before — a STARTED marker is an exception the resolver
  // parked and un-parked, not a fresh legacy company.
  if (existingMarker === null) {
    return { cohortKind: LEGACY_COHORT, cohortEvidence: 'FIRST_NORMALIZATION_RULE' };
  }
  if (isCohortKind(existingMarker.cohortKind)) {
    return { cohortKind: existingMarker.cohortKind, cohortEvidence: 'EXISTING_MARKER' };
  }
  const legacyPasses = await client.auditLog.count({
    where: {
      companyId,
      action: 'system.entitlement.normalize',
      metadataJson: { path: ['grantOrigin'], equals: LEGACY_GRANT_ORIGIN },
    },
  });
  if (legacyPasses > 0) {
    return { cohortKind: LEGACY_COHORT, cohortEvidence: 'LEGACY_NORMALIZATION_AUDIT' };
  }
  // A draft/cancelled/failed setup attempt is not evidence that entitlement choices were completed.
  // Fail closed to staff review instead of silently waiving LEGACY provenance for imported/future rows.
  const onboardingRuns = await client.companyOnboardingRun.count({
    where: { companyId, status: 'COMPLETED' },
  });
  return onboardingRuns > 0
    ? { cohortKind: EXPLICIT_COHORT, cohortEvidence: 'COMPANY_ONBOARDING_RUN' }
    : { cohortKind: null, cohortEvidence: 'UNRESOLVED' };
}

/**
 * External r9 — THE ONE definition of "this company is already normalized", used by both early
 * returns below and mirrored by `pendingCompanyWhere`: COMPLETED, at this generation, WITH a valid
 * cohort. It is a function because the two checks used to be two hand-written copies of the first
 * two conditions, and the missing third one was a dead end — a marker COMPLETED at this generation
 * with NO cohort read as complete HERE while `pendingCompanyWhere`, the partner write gate
 * (`normalizationCurrent`, set-partner-features.use-case.ts) and verify all read it as pending. Nothing
 * could then reach the pass that stamps the `grantOrigin=LEGACY` provenance verify demands, not even
 * after an operator recorded the cohort by hand.
 */
export function isCurrentEntitlementNormalization(
  marker: { status: string; normalizerVersion: number; cohortKind: string | null } | null | undefined,
): boolean {
  if (!marker) return false;
  return marker.status === 'COMPLETED'
    && marker.normalizerVersion >= NORMALIZER_VERSION
    && isCohortKind(marker.cohortKind);
}

/**
 * ONE retry-idempotent SYSTEM bootstrap command for one company (spec:233).
 *
 * dry-run/hash → exclusive company entitlement lock → recompute → hash revalidation →
 * `setVersion` CAS bumped exactly once → changed rows + transitions + orphan removal + audit +
 * COMPLETED marker, all in the same transaction. An already-COMPLETED company is a no-op that
 * returns its stored hash.
 */
export async function normalizeCompanyEntitlements(
  prisma: PrismaService,
  companyId: string,
  options: NormalizeCompanyOptions,
): Promise<NormalizeCompanyResult> {
  const existingMarker = await prisma.client.companyEntitlementNormalization.findUnique({
    where: { companyId },
    select: { status: true, snapshotHash: true, normalizerVersion: true, cohortKind: true },
  });
  if (existingMarker && isCurrentEntitlementNormalization(existingMarker)) {
    return {
      companyId,
      status: 'ALREADY_COMPLETED',
      cohortKind: existingMarker.cohortKind as CohortKind,
      cohortEvidence: 'EXISTING_MARKER',
      hash: existingMarker.snapshotHash,
      written: 0,
      unchanged: CANONICAL_KEYS.length,
      removed: 0,
      orphanRows: [],
      setVersion: null,
      provenance: 0,
      writes: [],
      dependencyFindings: [],
    };
  }
  /**
   * UAT r8 A2 — the COHORT drives the provenance stamp, not "is this the first pass".
   *
   * `!alreadyCompleted` was wrong in both directions. An EXPLICIT company whose marker the exception
   * resolver reset to STARTED came back as "first-ever legacy company" and was stamped
   * `grantOrigin=LEGACY` — manufactured grandfather evidence. And a LEGACY company coming back
   * through that same reset, or through a version-bump repair that re-creates a row, was NOT
   * stamped — while verify demands the stamp on every effective-ON row of a LEGACY company, so the
   * deploy gate would fail on a provenance gap nothing could close.
   *
   * Reading it off the cohort answers both: the stamp says "this company's access predates explicit
   * entitlements", which is a property of the COMPANY and stays true across every later pass.
   */
  const { cohortKind, cohortEvidence } = await cohortResolutionOf(prisma.client, companyId, existingMarker);
  const isLegacyCohort = cohortKind === LEGACY_COHORT;

  const plan = planCompanyNormalization(
    companyId,
    await loadRows(prisma.client, companyId),
    cohortKind,
    await humanDecidedKeys(prisma.client, companyId),
  );
  // UAT r7 P0-4 — refused before the lock is even taken, so an unapproved company costs one read.
  if (options.expectedPlanHash !== undefined && plan.hash !== options.expectedPlanHash) {
    throw new UnapprovedPlanError(companyId, options.expectedPlanHash, plan.hash);
  }
  const exceptions = plan.dependencyFindings.filter((finding) => finding.action === 'EXCEPTION');
  if (options.dryRun) {
    return {
      companyId,
      status: 'DRY_RUN',
      cohortKind,
      cohortEvidence,
      hash: plan.hash,
      // Under DRY_RUN this is the proposed write count — nothing is persisted.
      written: plan.writes.length,
      unchanged: plan.proposedRows.length - plan.writes.length,
      removed: plan.orphanRows.length,
      orphanRows: plan.orphanRows,
      setVersion: null,
      provenance: plan.provenanceKeys.length,
      writes: plan.writes,
      dependencyFindings: plan.dependencyFindings,
    };
  }

  // No durable cohort means there is no approved marker/provenance mutation to make. Refuse before
  // even materializing the CAS root; the dry-run above still exposes the exact plan for review.
  if (cohortKind === null) {
    return {
      companyId,
      status: 'UNRESOLVED_COHORT',
      cohortKind,
      cohortEvidence,
      hash: plan.hash,
      written: 0,
      unchanged: plan.proposedRows.length - plan.writes.length,
      removed: 0,
      orphanRows: plan.orphanRows,
      setVersion: null,
      provenance: 0,
      writes: [],
      dependencyFindings: plan.dependencyFindings,
    };
  }

  // Ruling 4b — record the exception and stop. Deliberately NO partial write: the company keeps the
  // rows it has until support resolves the dependency, and the deploy gate reads it as incomplete.
  if (exceptions.length > 0) {
    const error = dependencyExceptionMessage(exceptions);
    // UAT r8 A2 — the parked marker carries the cohort the plan ran under. Without it the FIRST
    // pass over a legacy company created a cohort-less marker, and every later pass then read that
    // marker as "seen before, cohort unknown" — the company lost its cohort by being parked.
    await prisma.client.companyEntitlementNormalization.upsert({
      where: { companyId },
      create: { companyId, status: 'FAILED', snapshotHash: plan.hash, runId: options.runId, error, cohortKind },
      update: { status: 'FAILED', snapshotHash: plan.hash, runId: options.runId, error, cohortKind, completedAt: null },
    });
    return {
      companyId,
      status: 'EXCEPTION',
      cohortKind,
      cohortEvidence,
      hash: plan.hash,
      written: 0,
      unchanged: plan.proposedRows.length - plan.writes.length,
      removed: 0,
      orphanRows: plan.orphanRows,
      setVersion: null,
      provenance: 0,
      writes: [],
      dependencyFindings: plan.dependencyFindings,
    };
  }

  // Lazily materialize the CAS root at version 0 — upsert, never create-then-catch (a P2002 inside
  // a transaction poisons it), and outside the transaction so the first-ever pass does not race its
  // own row creation against the CAS below.
  const set = await prisma.client.companyEntitlementSet.upsert({
    where: { companyId },
    create: { companyId },
    update: {},
    select: { setVersion: true },
  });
  const expectedSetVersion = set.setVersion;
  const resultSetVersion = expectedSetVersion + 1;

  return prisma.client.$transaction(async (tx) => {
    // The exclusive half of the CC1 claim protocol (spec:60), the same key the partner entitlement
    // command takes, sharded per company so tenants never serialize on one another.
    await tx.$executeRaw(exclusiveEntitlementLock(companyId));

    // A concurrent pass may have completed while we waited for the lock; its work stands. The SAME
    // predicate as the entry check — this is not only a concurrency guard, it is a second gate on
    // the same marker, so a cohort-less company skipped here is skipped just as permanently.
    const marker = await tx.companyEntitlementNormalization.findUnique({
      where: { companyId },
      select: { status: true, snapshotHash: true, normalizerVersion: true, cohortKind: true },
    });
    if (marker && isCurrentEntitlementNormalization(marker)) {
      return {
        companyId,
        status: 'ALREADY_COMPLETED' as const,
        cohortKind: marker.cohortKind as CohortKind,
        cohortEvidence: 'EXISTING_MARKER' as const,
        hash: marker.snapshotHash,
        written: 0,
        unchanged: CANONICAL_KEYS.length,
        removed: 0,
        orphanRows: [],
        setVersion: null,
        provenance: 0,
        writes: [],
        dependencyFindings: [],
      };
    }

    const rows = await loadRows(tx, companyId);
    // Re-loaded under the lock, like the rows: a human decision that landed between the plan and the
    // lock changes what this apply may stamp, so it must move the hash and refuse the stale plan.
    const humanDecided = await humanDecidedKeys(tx, companyId);
    const locked = planCompanyNormalization(companyId, rows, cohortKind, humanDecided);
    // Hash revalidation (spec:233). Something changed the rows between the dry run and the lock —
    // a stale plan must never overwrite it. On an UNBOUND run that is a safe retry; on a hash-bound
    // apply it is terminal, because re-planning would produce exactly the unreviewed plan P0-4
    // exists to prevent.
    if (locked.hash !== plan.hash && options.expectedPlanHash !== undefined) {
      throw new UnapprovedPlanError(companyId, options.expectedPlanHash, locked.hash);
    }
    if (locked.hash !== plan.hash) {
      throw new ConflictException({
        code: 'entitlement_normalization_hash_changed',
        message: 'Entitlement rows changed between the dry run and the lock. Retry.',
        companyId,
      });
    }

    const cas = await tx.companyEntitlementSet.updateMany({
      where: { companyId, setVersion: expectedSetVersion },
      data: { setVersion: resultSetVersion, lastTransitionAt: new Date() },
    });
    if (cas.count !== 1) {
      throw new ConflictException({
        code: 'entitlement_set_version_conflict',
        message: 'The entitlement set changed while normalizing. Retry.',
        companyId,
        expectedSetVersion,
      });
    }

    const fences = new Map(rows.map((row) => [row.featureKey, { epoch: row.epoch ?? 0, lastSeq: row.lastSeq ?? 0 }]));
    /**
     * The entitlement row is not the only record of a key's fences: `EntitlementTransition` is
     * append-only and outlives it. A key whose row was deleted (an orphan removal, a repair pass
     * re-creating a row) restarts at seq 0 and collides with its own history on the
     * `(companyId, featureKey, seq)` unique index — and an epoch restarting at 0 would re-validate
     * a claim fenced before the row disappeared. Both counters therefore continue from the higher
     * of the row and the history.
     */
    const history = await tx.entitlementTransition.groupBy({
      by: ['featureKey'],
      where: { companyId },
      _max: { seq: true, epoch: true },
    });
    const historyFences = new Map(history.map((row) => [row.featureKey, { epoch: row._max.epoch ?? 0, lastSeq: row._max.seq ?? 0 }]));
    for (const write of locked.writes) {
      const fence = fences.get(write.featureKey) ?? { epoch: 0, lastSeq: 0 };
      const priorFence = historyFences.get(write.featureKey) ?? { epoch: 0, lastSeq: 0 };
      const baseEpoch = Math.max(fence.epoch, priorFence.epoch);
      // spec:51 — the epoch moves only on a real non-ON→ON transition. Materializing a row for a
      // feature that was ALREADY effectively on is storage normalization, not a new grant, so live
      // claims fenced on the old epoch stay valid.
      const epoch = write.toEnabled && !write.fromEnabled ? baseEpoch + 1 : baseEpoch;
      const seq = Math.max(fence.lastSeq, priorFence.lastSeq) + 1;
      // CC7 ruling 5 — the grandfather marker records ACCESS, never its absence: an OFF row is
      // cleared to null. `undefined` leaves whatever is there alone — an earlier pass's stamp on the
      // non-legacy path, and (UAT r8) the null a human's own decision left behind, which this pass
      // must not overwrite even while it corrects that row's VALUE.
      const grantOrigin = write.toEnabled
        ? (isLegacyCohort && !humanDecided.has(write.featureKey) ? LEGACY_GRANT_ORIGIN : undefined)
        : null;
      await tx.companyFeatureEntitlement.upsert({
        where: { companyId_featureKey: { companyId, featureKey: write.featureKey } },
        create: {
          companyId,
          featureKey: write.featureKey,
          enabled: write.toEnabled,
          epoch,
          lastSeq: seq,
          grantOrigin,
        },
        update: { enabled: write.toEnabled, epoch, lastSeq: seq, grantOrigin },
      });
      await tx.entitlementTransition.create({
        data: {
          companyId,
          featureKey: write.featureKey,
          seq,
          epoch,
          commandId: `normalize:${options.runId}`,
          action: write.toEnabled ? 'ENABLE' : 'OFF',
          actorUserId: SYSTEM_ACTOR,
          reasonJson: {
            runId: options.runId,
            fromEnabled: write.fromEnabled,
            normalization: true,
            reason: write.reason,
            // Only when the pass really is stamping the grandfather cohort. It used to be recorded
            // unconditionally, which made a repair pass's transitions read as legacy grants.
            ...(isLegacyCohort ? { grantOrigin: LEGACY_GRANT_ORIGIN } : {}),
          },
        },
      });
    }

    // CC7 ruling 5 — EVERY effective-ON row of a legacy company carries the cohort marker, not just
    // the ones whose value had to be rewritten: the grandfather cohort is "what this company could
    // already do", and a row that happened to agree with the evaluator is just as grandfathered.
    // RAW SQL on purpose. Prisma stamps `@updatedAt` on every client-side update, and
    // `expense_auto_post.updatedAt` is the auto-post worker's activation cutoff
    // (ledger/application/use-cases/expense-auto-post.use-case.ts:94) — restamping an unchanged row
    // would silently re-scope which expenses that worker considers. This UPDATE touches one column.
    // UAT r6 — taken from the PLAN, so the hash the approver signed off on covers exactly this set.
    const legacyOnKeys = locked.provenanceKeys;
    if (legacyOnKeys.length > 0) {
      await tx.$executeRaw(Prisma.sql`
        UPDATE "CompanyFeatureEntitlement"
           SET "grantOrigin" = ${LEGACY_GRANT_ORIGIN}
         WHERE "companyId" = ${companyId}
           AND "featureKey" IN (${Prisma.join(legacyOnKeys)})
           AND "grantOrigin" IS DISTINCT FROM ${LEGACY_GRANT_ORIGIN}`);
    }

    if (locked.orphanRows.length > 0) {
      await tx.companyFeatureEntitlement.deleteMany({
        where: { companyId, featureKey: { in: locked.orphanRows.map((row) => row.featureKey) } },
      });
    }

    await tx.auditLog.create({
      data: {
        companyId,
        // `actorUserId` is a real FK to User, so the SYSTEM actor is the actorType, not a literal id.
        actorType: 'SYSTEM',
        action: 'system.entitlement.normalize',
        targetType: 'company',
        targetId: companyId,
        requestId: options.runId,
        result: 'SUCCESS',
        riskLevel: 'HIGH',
        metadataJson: {
          runId: options.runId,
          snapshotHash: locked.hash,
          setVersion: resultSetVersion,
          normalizerVersion: NORMALIZER_VERSION,
          ...(isLegacyCohort ? { grantOrigin: LEGACY_GRANT_ORIGIN, legacyOnKeys: legacyOnKeys.length } : {}),
          writes: locked.writes,
          unchanged: locked.proposedRows.length - locked.writes.length,
          removedOrphanRows: locked.orphanRows,
          ...(locked.dependencyFindings.length > 0 ? { dependencyFindings: locked.dependencyFindings } : {}),
        },
      },
    });

    await tx.companyEntitlementNormalization.upsert({
      where: { companyId },
      create: {
        companyId,
        status: 'COMPLETED',
        snapshotHash: locked.hash,
        runId: options.runId,
        normalizerVersion: NORMALIZER_VERSION,
        cohortKind,
        completedAt: new Date(),
      },
      update: {
        status: 'COMPLETED',
        snapshotHash: locked.hash,
        runId: options.runId,
        normalizerVersion: NORMALIZER_VERSION,
        cohortKind,
        error: null,
        completedAt: new Date(),
      },
    });

    return {
      companyId,
      status: 'COMPLETED' as const,
      cohortKind,
      cohortEvidence,
      hash: locked.hash,
      written: locked.writes.length,
      unchanged: locked.proposedRows.length - locked.writes.length,
      removed: locked.orphanRows.length,
      orphanRows: locked.orphanRows,
      setVersion: resultSetVersion,
      provenance: legacyOnKeys.length,
      writes: locked.writes,
      dependencyFindings: locked.dependencyFindings,
    };
  }, { timeout: 60_000, maxWait: 20_000 });
}

export type NormalizeAllOptions = {
  runId: string;
  dryRun?: boolean;
  /** Small on purpose: this runs while the OLD version is still serving traffic. */
  concurrency?: number;
  /** Restricts the pass to these companies. Omitted = every pending company (the release flow). */
  companyIds?: readonly string[];
  /**
   * UAT r7 P0-4 — the reviewed `{companyId → planHash}` map from ONE artifact. Setting it makes the
   * run HASH-BOUND, which changes three things:
   *   - membership FREEZES to the map's keys, so a company created after the review never joins;
   *   - every company is applied only if its plan still hashes to the approved value;
   *   - the retry is gone, because a retry re-plans and a re-plan is by definition unreviewed.
   * Companies pending in the database but absent from the map are skipped and reported, never applied.
   */
  approvedPlanHashes?: Readonly<Record<string, string>>;
  log?: (message: string) => void;
};

export type NormalizeAllResult = {
  total: number;
  completed: number;
  skipped: number;
  failed: number;
  /** Ruling 4b — companies blocked on a dependency only support can resolve. Counted in `failed`. */
  dependencyExceptions: number;
  /** Planned companies whose durable LEGACY/EXPLICIT cohort still cannot be established. */
  unresolvedCohorts: number;
  /** Companies still not COMPLETED after the pass. Non-zero must abort the deploy (spec:237). */
  normalizationIncomplete: number;
  errors: Array<{ companyId: string; error: string }>;
  /** Per-company detail for the release-task artifact, in the order the pass produced it. */
  companies: NormalizeCompanyResult[];
  /** UAT r6 — the ONE canonical number over this run. Printed by the dry run, required by apply. */
  aggregateHash: string;
  /**
   * UAT r7 P0-4 — the IMMUTABLE per-company approval unit: `{companyId → planHash}`, with
   * `PLAN_FAILED` for a company whose plan crashed. This is what a human approves and what apply
   * binds each company to; `aggregateHash` is derived from it, so the two can never disagree.
   */
  planHashes: Record<string, string>;
  /**
   * UAT r7 P0-4 — companies the database still lists as pending that the approved artifact does not
   * cover. They are NOT applied (that is the membership freeze) and are reported here so the run
   * cannot silently leave them behind: they need a fresh plan, reviewed on its own.
   */
  skippedOutsideApprovedPlan: string[];
};

/**
 * Companies the gate still refuses: no marker, a marker that never reached COMPLETED, one completed
 * by an OLDER normalizer than the code now running (ruling 5 — raising `NORMALIZER_VERSION` re-opens
 * already-COMPLETED companies for repair), or one whose marker records no VALID cohort (external
 * r9 — the same "complete" the entry check, the partner write gate and verify use).
 *
 * Exported for the exception resolver (UAT r8 A1): the set of companies a dependency exception can
 * exist in is exactly the set the runner would plan, and the two must never drift apart.
 */
export function pendingCompanyWhere(companyIds?: readonly string[]) {
  return {
    ...(companyIds ? { id: { in: [...companyIds] } } : {}),
    OR: [
      { entitlementNormalization: { is: null } },
      { entitlementNormalization: { status: { not: 'COMPLETED' as const } } },
      { entitlementNormalization: { normalizerVersion: { lt: NORMALIZER_VERSION } } },
      // Two clauses, not one `notIn`: SQL never matches NULL with `NOT IN`, and NULL is the common
      // case here — it is the r8 "no durable evidence" outcome, which must stay selectable so a
      // cohort that becomes derivable later is picked up, and so a hand-recorded one can be stamped.
      { entitlementNormalization: { cohortKind: null } },
      { entitlementNormalization: { cohortKind: { notIn: [...COHORT_KINDS] } } },
    ],
  };
}

/**
 * The all-companies runner. Bounded concurrency, one retry per company (a hash mismatch or a CAS
 * conflict is a safe retry by construction), and a final independent count so the caller aborts on
 * evidence rather than on the loop's own bookkeeping.
 */
export async function normalizeAllCompanyEntitlements(
  prisma: PrismaService,
  options: NormalizeAllOptions,
): Promise<NormalizeAllResult> {
  const log = options.log ?? (() => {});
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 4, 16));
  const approved = options.approvedPlanHashes;
  // The membership freeze. A hash-bound run considers ONLY the approved ids; pending companies
  // outside the map are read once, reported, and never touched.
  const scopedIds = approved
    ? (options.companyIds ?? Object.keys(approved)).filter((companyId) => companyId in approved)
    : options.companyIds;
  const companies = await prisma.client.company.findMany({
    where: pendingCompanyWhere(scopedIds),
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  const skippedOutsideApprovedPlan = approved
    ? (await prisma.client.company.findMany({
      where: pendingCompanyWhere(options.companyIds),
      select: { id: true },
      orderBy: { id: 'asc' },
    })).map((company) => company.id).filter((companyId) => !(companyId in approved))
    : [];
  for (const companyId of skippedOutsideApprovedPlan) {
    log(`  ${companyId} SKIPPED_OUTSIDE_APPROVED_PLAN — pending but not in the approved artifact`);
  }

  const result: NormalizeAllResult = {
    total: companies.length,
    completed: 0,
    skipped: 0,
    failed: 0,
    dependencyExceptions: 0,
    unresolvedCohorts: 0,
    normalizationIncomplete: 0,
    errors: [],
    companies: [],
    aggregateHash: aggregateNormalizationHash([]),
    planHashes: {},
    skippedOutsideApprovedPlan,
  };

  let cursor = 0;
  // A hash-bound apply gets ONE attempt: the retry exists to re-plan after a conflict, and a
  // re-plan is exactly the unreviewed mutation P0-4 forbids.
  const maxAttempts = approved ? 1 : 2;
  const worker = async () => {
    while (cursor < companies.length) {
      const company = companies[cursor++]!;
      const expectedPlanHash = approved?.[company.id];
      // A company whose PLAN itself crashed was reviewed as "no plan at all". It can never be
      // applied from this artifact, even if whatever broke it has since been fixed.
      if (approved && expectedPlanHash !== undefined && !/^[0-9a-f]{64}$/.test(expectedPlanHash)) {
        const message = `${PLAN_FAILED}: the approved artifact carries no reviewable plan for this company.`;
        result.failed += 1;
        result.errors.push({ companyId: company.id, error: message });
        log(`  ${company.id} FAILED ${message}`);
        continue;
      }
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          const one = await normalizeCompanyEntitlements(prisma, company.id, {
            runId: options.runId,
            dryRun: options.dryRun,
            ...(expectedPlanHash !== undefined ? { expectedPlanHash } : {}),
          });
          result.companies.push(one);
          // Counted on a dry run too, so the preflight artifact reports every blocker even when the
          // same company also lacks cohort evidence.
          const exceptions = one.dependencyFindings.filter((finding) => finding.action === 'EXCEPTION');
          if (exceptions.length > 0) result.dependencyExceptions += 1;
          if (one.cohortKind === null) {
            const message = `entitlement_cohort_unresolved: no durable LEGACY or EXPLICIT evidence for ${company.id}.`;
            result.unresolvedCohorts += 1;
            // Keep this as an ordinary failure so the existing CLI's approvalReady formula remains
            // fail-closed without adding another downstream gate.
            result.failed += 1;
            result.errors.push({ companyId: company.id, error: message });
            log(`  ${company.id} UNRESOLVED_COHORT evidence=${one.cohortEvidence}`);
            break;
          }
          if (one.status === 'EXCEPTION') {
            // Not a crash and not retryable: staff has to decide. Counted as failed so the deploy
            // gate and the summary both see it.
            const message = dependencyExceptionMessage(exceptions);
            result.failed += 1;
            result.errors.push({ companyId: company.id, error: message });
            log(`  ${company.id} EXCEPTION ${message}`);
            break;
          }
          if (one.status === 'ALREADY_COMPLETED') result.skipped += 1;
          else result.completed += 1;
          log(
            `  ${company.id} ${one.status} hash=${one.hash.slice(0, 12)} `
            + `${one.status === 'DRY_RUN' ? 'wouldWrite' : 'written'}=${one.written} `
            + `unchanged=${one.unchanged} removed=${one.removed} provenance=${one.provenance} `
            + `cohort=${one.cohortKind} evidence=${one.cohortEvidence}`
            + (one.dependencyFindings.length > 0 ? ` dependencies=${one.dependencyFindings.length}` : ''),
          );
          break;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (attempt === maxAttempts) {
            result.failed += 1;
            result.errors.push({ companyId: company.id, error: message });
            log(`  ${company.id} FAILED ${message}`);
          } else {
            log(`  ${company.id} retrying after: ${message}`);
          }
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, companies.length) }, worker));

  // Companies that crashed have no plan hash at all. Aggregating over what DID plan would let a run
  // whose failure set changed still match an approved hash, so a failure is folded in by id under
  // the `PLAN_FAILED` sentinel — which a later apply refuses outright rather than re-planning.
  result.planHashes = Object.fromEntries([
    ...result.companies.map((one) => [one.companyId, one.hash] as const),
    ...result.errors
      .filter((failure) => !result.companies.some((one) => one.companyId === failure.companyId))
      .map((failure) => [failure.companyId, PLAN_FAILED] as const),
  ].sort((a, b) => a[0].localeCompare(b[0])));
  result.aggregateHash = aggregateNormalizationHash(
    Object.entries(result.planHashes).map(([companyId, hash]) => ({ companyId, hash })),
  );

  // Independent evidence, not the loop counters: this is the number the deploy gate reads.
  result.normalizationIncomplete = options.dryRun
    ? companies.length
    : await prisma.client.company.count({ where: pendingCompanyWhere(options.companyIds) });
  return result;
}

export type VerifyNormalizationResult = {
  total: number;
  /** No marker, not COMPLETED, or completed by an older normalizer. */
  incomplete: number;
  /** Companies whose STORED rows still disagree with the plan. Must be empty after an apply. */
  drifted: Array<{ companyId: string; hash: string; writes: number; orphans: number; exceptions: number }>;
  /**
   * UAT r6 — grandfathered companies whose provenance stamp did not fully land. The value check
   * above cannot see this: `grantOrigin` is written by a raw UPDATE that touches no value, so a
   * company can be a perfect fixed point and still be missing the cohort marker the day-14 removal
   * of legacy semantics depends on.
   */
  provenanceGaps: Array<{ companyId: string; missing: string[] }>;
};

/**
 * Ruling 3c — the post-apply check, and a standalone operator command.
 *
 * Re-derives the deterministic plan from the rows that are actually stored now and requires it to
 * be a FIXED POINT: nothing left to write, no orphan, no dependency exception, and a COMPLETED
 * marker at the current normalizer version for every company. Comparing the stored `snapshotHash`
 * would prove less — that hash describes the pre-write state, so it cannot tell whether the write
 * actually landed.
 *
 * ponytail: one plan per company, no batching. This runs once per release on tens of companies; if
 * the tenant count ever makes that slow, page it the same way the runner does.
 */
export async function verifyCompanyNormalizations(
  prisma: PrismaService,
  options: { companyIds?: readonly string[]; log?: (message: string) => void } = {},
): Promise<VerifyNormalizationResult> {
  const log = options.log ?? (() => {});
  const companies = await prisma.client.company.findMany({
    where: options.companyIds ? { id: { in: [...options.companyIds] } } : {},
    select: {
      id: true,
      entitlementNormalization: {
        select: { status: true, normalizerVersion: true, completedAt: true, cohortKind: true },
      },
    },
    orderBy: { id: 'asc' },
  });

  const result: VerifyNormalizationResult = { total: companies.length, incomplete: 0, drifted: [], provenanceGaps: [] };
  for (const company of companies) {
    const marker = company.entitlementNormalization;
    // UAT r7 — a null `cohortKind` is INCOMPLETE, not a company to guess about. Every marker at the
    // current normalizer version was written by code that records the cohort, so null can only mean
    // the marker predates it and its grandfather claim was never verified.
    // UAT r8 A3 — and a value OUTSIDE `COHORT_KINDS` is INVALID, never "well, it isn't LEGACY, so
    // treat it as EXPLICIT": that reading waives the grandfather provenance check on the strength of
    // a typo. Reported by name so the operator sees what the column actually holds.
    if (marker?.status !== 'COMPLETED' || marker.normalizerVersion < NORMALIZER_VERSION || !isCohortKind(marker.cohortKind)) {
      result.incomplete += 1;
      const cohort = marker?.cohortKind == null
        ? 'MISSING'
        : (isCohortKind(marker.cohortKind) ? marker.cohortKind : `INVALID(${marker.cohortKind})`);
      log(
        `  ${company.id} INCOMPLETE status=${marker?.status ?? 'MISSING'} `
        + `version=${marker?.normalizerVersion ?? '-'} cohort=${cohort}`,
      );
      continue;
    }
    const rows = await loadRows(prisma.client, company.id);
    const humanDecided = await humanDecidedKeys(prisma.client, company.id);
    const plan = planCompanyNormalization(company.id, rows, marker.cohortKind, humanDecided);
    /**
     * UAT r7 — the cohort comes from the MARKER, not from the stamps. Inferring it from
     * `rows.some(grantOrigin = LEGACY)` made the check self-fulfilling: a legacy company whose
     * provenance UPDATE never ran has zero stamps, so it read as "not grandfathered" and passed
     * with its entire cohort marker missing — the exact failure the check exists to catch.
     *
     * Every effective-ON row of a LEGACY company must carry the stamp (CC7 ruling 5). OFF rows are
     * NOT policed: a grandfathered grant that some later lifecycle switched off legitimately keeps
     * the marker on a disabled row.
     *
     * A key an OPERATOR decided is exempt, not a gap: `SetPartnerFeaturesUseCase` clears
     * `grantOrigin` on every row it writes AND on every legacy row it re-confirms, because an
     * explicit decision is not a grandfathered grant.
     *
     * UAT r8 A4 — the exemption is `humanDecidedKeys`, and it is PERMANENT. Two earlier readings
     * were both wrong: a Prisma `@updatedAt` later than the pass (any write at all produces one, so
     * a future non-entitlement write would hide a real gap), and a transition later than the pass
     * (`completedAt` is rewritten by every pass, so each repair expired the operator's decision and
     * the next stamp reverted it). A transition is written only by a deliberate entitlement
     * decision, it names the actor, and it is append-only — so it is the one signal that outlives
     * the repair passes it has to outlive. It is the SAME set the plan excludes from
     * `provenanceKeys`, so the stamp the apply writes and the stamp verify demands cannot disagree.
     */
    if (marker.cohortKind === LEGACY_COHORT) {
      const stored = new Map(rows.map((row) => [row.featureKey, row]));
      const missing = plan.proposedRows
        .filter((row) => (
          row.enabled
          && stored.get(row.featureKey)?.grantOrigin !== LEGACY_GRANT_ORIGIN
          && !humanDecided.has(row.featureKey)
        ))
        .map((row) => row.featureKey);
      if (missing.length > 0) {
        result.provenanceGaps.push({ companyId: company.id, missing });
        log(`  ${company.id} PROVENANCE_GAP missing=${missing.length} (${missing.slice(0, 5).join(', ')})`);
      }
    }
    const exceptions = plan.dependencyFindings.filter((finding) => finding.action === 'EXCEPTION').length;
    if (plan.writes.length > 0 || plan.orphanRows.length > 0 || exceptions > 0) {
      result.drifted.push({
        companyId: company.id,
        hash: plan.hash,
        writes: plan.writes.length,
        orphans: plan.orphanRows.length,
        exceptions,
      });
      log(`  ${company.id} DRIFTED writes=${plan.writes.length} orphans=${plan.orphanRows.length} exceptions=${exceptions}`);
    }
  }
  return result;
}
