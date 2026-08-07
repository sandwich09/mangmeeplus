/**
 * F2 / CC7 legacy entitlement normalization for EVERY existing company (spec:232-238).
 *
 * THREE MODES, and the default is the harmless one (UAT r5 ruling 3):
 *
 *   (default)      PLAN — dry run: plan + deterministic hash for every pending company, nothing
 *                  written, a JSON artifact on stdout and on disk. This is what a GENERIC deploy
 *                  runs: the writer must never become a fixture of every release.
 *   F2_APPLY=true  APPLY — the one-time coordinated run, ARMED by this flag and AUTHORIZED by the
 *                  reviewed PLAN artifact (`--approved-plan=<file>`). Writes, then verifies.
 *   F2_VERIFY=true re-check only (same as `--verify`): every company must have a COMPLETED marker at
 *                  the current normalizer version, a recorded cohort, stored rows that are already
 *                  the plan's fixed point, and the grandfather provenance stamp actually landed.
 *   --dry-run      forces PLAN even when F2_APPLY/F2_VERIFY is set (the boot path passes this, so a
 *                  flag left on a service task definition can never arm anything at boot).
 *
 * UAT r7 P0-4 — APPLY IS BOUND TO THE ARTIFACT, COMPANY BY COMPANY. A single aggregate hash was not
 * enough: it was checked once, and then a FRESH runner re-planned everything, so a company whose
 * rows moved in the seconds after the check was applied from a plan no human ever saw (its own
 * retry re-planned it on conflict, and a failed plan hashed as a constant sentinel that a recovered
 * company could then match). APPLY now carries the whole reviewed `{companyId → planHash}` map:
 *
 *   - membership FREEZES to that map — a company created after the review never joins the run, and
 *     a pending company the artifact does not cover is skipped and REPORTED, never applied;
 *   - inside each company's lock the plan is recomputed and must still hash to the approved value;
 *   - a mismatch, a conflict, or a `PLAN_FAILED` entry fails THAT company permanently for this run,
 *     with zero writes and no retry, while every other company proceeds and commits on its own;
 *   - VERIFY always runs at the end, even after failures, and both results are reported.
 *
 * An artifact whose PLAN had failures, dependency exceptions, or unresolved cohort evidence
 * carries `approvalReady:false` and APPLY refuses it outright.
 *
 * Deploy gate — the release/boot scripts run with `set -eu`, so a non-zero exit here stops the
 * rollout and the old version keeps running.
 *
 * The artifact is written to `F2_ARTIFACT_PATH` (default `/tmp/normalize-entitlements-<runId>.json`)
 * AND printed to stdout, because a Fargate task's filesystem dies with the task: the log is the
 * durable copy, the file is for a local or UAT operator.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../src/generated/prisma/client';
import type { PrismaService } from '../src/common/database/prisma.service';
import {
  NORMALIZER_VERSION,
  normalizeAllCompanyEntitlements,
  verifyCompanyNormalizations,
  type NormalizeAllResult,
} from '../src/modules/employee-access/application/normalize-entitlements';

type Mode = 'dry-run' | 'apply' | 'verify';

/** The reviewed PLAN artifact, reduced to the two fields an apply is authorized by. */
type ApprovedPlan = { aggregateHash: string; planHashes: Record<string, string> };

/**
 * Explicit flags beat the environment, so the boot path can hard-wire the read-only mode.
 * `--dry-run` is checked before any arming flag for exactly that reason.
 */
function modeOf(argv: readonly string[], env: NodeJS.ProcessEnv): Mode {
  if (argv.includes('--verify')) return 'verify';
  if (argv.includes('--dry-run')) return 'dry-run';
  if (env['F2_VERIFY'] === 'true') return 'verify';
  return env['F2_APPLY'] === 'true' ? 'apply' : 'dry-run';
}

function argOf(argv: readonly string[], name: string, env: NodeJS.ProcessEnv, envKey: string): string {
  const flag = argv.find((arg) => arg.startsWith(`${name}=`))?.slice(`${name}=`.length);
  return (flag ?? env[envKey] ?? '').trim();
}

/**
 * The approval the apply is bound to: the whole reviewed artifact, by path or on stdin (`-`), so
 * the ECS release task can pipe the PLAN job's own output straight in.
 *
 * Every rejection here happens before the database is opened. A truncated paste, an artifact from
 * another normalizer generation, or one whose PLAN was not clean is an operator error — not a run
 * that should get as far as touching data.
 */
function loadApprovedPlan(source: string): ApprovedPlan {
  const raw = source === '-' ? readFileSync(0, 'utf8') : readFileSync(source, 'utf8');
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  if (parsed['artifact'] !== 'f2-entitlement-normalization') {
    throw new Error(`not an entitlement normalization artifact (artifact=${String(parsed['artifact'])})`);
  }
  if (parsed['normalizerVersion'] !== NORMALIZER_VERSION) {
    throw new Error(
      `artifact was planned by normalizer version ${String(parsed['normalizerVersion'])}, this build is `
      + `${NORMALIZER_VERSION} — the rules changed, so re-plan and re-approve.`,
    );
  }
  if (parsed['approvalReady'] !== true) {
    throw new Error(
      'artifact carries approvalReady=false — its PLAN had failures, dependency exceptions, or '
      + 'unresolved cohort evidence. Resolve them, then re-plan and approve a clean artifact.',
    );
  }
  const aggregateHash = String(parsed['aggregateHash'] ?? '');
  if (!/^[0-9a-f]{64}$/.test(aggregateHash)) throw new Error('artifact has no valid aggregateHash');
  const planHashes = parsed['planHashes'];
  if (planHashes === null || typeof planHashes !== 'object' || Array.isArray(planHashes)) {
    throw new Error('artifact has no planHashes map — re-plan with this build.');
  }
  const entries = Object.entries(planHashes as Record<string, unknown>);
  if (entries.some(([, hash]) => typeof hash !== 'string')) throw new Error('planHashes must be {companyId: hash}');
  return { aggregateHash, planHashes: Object.fromEntries(entries) as Record<string, string> };
}

/**
 * The reviewable diff, not a dump of the final state: `writes` already carries before→after for
 * every row that moves, and the unchanged rows are identical by definition. A full 60-key dump per
 * company would push a large tenant list past CloudWatch's per-event limit and truncate the
 * evidence exactly when it matters.
 */
function artifactOf(mode: Mode, runId: string, result: NormalizeAllResult) {
  const reasonCounts: Record<string, number> = {};
  const cohortCounts = { LEGACY: 0, EXPLICIT: 0, UNRESOLVED: 0 };
  let orphanRows = 0;
  for (const company of result.companies) {
    for (const write of company.writes) reasonCounts[write.reason] = (reasonCounts[write.reason] ?? 0) + 1;
    if (company.cohortKind === 'LEGACY') cohortCounts.LEGACY += 1;
    else if (company.cohortKind === 'EXPLICIT') cohortCounts.EXPLICIT += 1;
    else cohortCounts.UNRESOLVED += 1;
    orphanRows += company.orphanRows.length;
  }
  if (result.unresolvedCohorts !== cohortCounts.UNRESOLVED) {
    throw new Error(
      `normalizer cohort count mismatch (reported=${result.unresolvedCohorts} `
      + `artifact=${cohortCounts.UNRESOLVED})`,
    );
  }
  return {
    artifact: 'f2-entitlement-normalization',
    mode,
    runId,
    normalizerVersion: NORMALIZER_VERSION,
    // The ONE value a human approves and the apply is bound to (UAT r6).
    aggregateHash: result.aggregateHash,
    // UAT r7 P0-4 — the IMMUTABLE per-company approval unit the apply binds each company to.
    // `PLAN_FAILED` entries are deliberately present: an apply refuses them by name instead of
    // quietly re-planning a company that had no reviewable plan.
    planHashes: result.planHashes,
    /**
     * UAT r7 P0-4 (c) — the gate on this artifact ever authorizing a write. A run with failures or
     * dependency exceptions or unresolved cohort evidence is REVIEWABLE (that is what the operator
     * needs to see) but never APPLIABLE: those companies have no agreed final state yet.
     */
    approvalReady: result.failed === 0
      && result.dependencyExceptions === 0
      && result.unresolvedCohorts === 0,
    generatedAt: new Date().toISOString(),
    total: result.total,
    completed: result.completed,
    skipped: result.skipped,
    failed: result.failed,
    dependencyExceptions: result.dependencyExceptions,
    cohortCounts,
    unresolvedCohorts: result.unresolvedCohorts,
    orphanRows,
    normalizationIncomplete: result.normalizationIncomplete,
    // Pending companies this artifact does not cover; the freeze refused them (apply only).
    skippedOutsideApprovedPlan: result.skippedOutsideApprovedPlan,
    reasonCounts,
    errors: result.errors,
    // Ruling 4b, made unmissable: the staff action list. These companies stay NOT COMPLETED and
    // read-only until support resolves the dependency; the apply deliberately writes nothing.
    dependencyExceptionCompanies: result.companies
      .filter((company) => company.dependencyFindings.some((finding) => finding.action === 'EXCEPTION'))
      .map((company) => ({
        companyId: company.companyId,
        unmet: company.dependencyFindings
          .filter((finding) => finding.action === 'EXCEPTION')
          .map((finding) => `${finding.featureKey} requires ${finding.requiresFeatureKey}`),
      })),
    companies: result.companies.map((company) => ({
      companyId: company.companyId,
      status: company.status,
      hash: company.hash,
      cohortKind: company.cohortKind,
      cohortEvidence: company.cohortEvidence,
      wouldWrite: company.written,
      unchanged: company.unchanged,
      orphansRemoved: company.removed,
      // Exact rows belong in the downloadable full artifact, never in the GitHub step summary.
      orphanRows: company.orphanRows,
      // The grantOrigin=LEGACY stamp is a mutation `writes` never reports (UAT r6).
      provenanceStamped: company.provenance,
      writes: company.writes,
      dependencyFindings: company.dependencyFindings,
    })),
  };
}

function emit(runId: string, payload: unknown): void {
  const json = JSON.stringify(payload, null, 2);
  console.log(json);
  const path = process.env['F2_ARTIFACT_PATH'] ?? `/tmp/normalize-entitlements-${runId}.json`;
  try {
    writeFileSync(path, `${json}\n`);
    console.log(`entitlement normalization: artifact written to ${path}`);
  } catch (error) {
    // A read-only filesystem must never fail a read-only preflight; stdout above is the real copy.
    console.warn(`entitlement normalization: could not write ${path}: ${(error as Error).message}`);
  }
}

async function main() {
  const mode = modeOf(process.argv, process.env);
  const requireReadOnly = process.argv.includes('--require-read-only');
  if (requireReadOnly && mode === 'apply') {
    throw new Error('--require-read-only cannot be combined with APPLY');
  }
  const allowExceptions = process.argv.includes('--allow-exceptions') || process.env['F2_ALLOW_EXCEPTIONS'] === 'true';
  let approvedPlan: ApprovedPlan | null = null;
  if (mode === 'apply') {
    const source = argOf(process.argv, '--approved-plan', process.env, 'F2_APPROVED_PLAN');
    if (source === '') {
      console.error(
        'entitlement normalization: APPLY requires the reviewed PLAN artifact — pass '
        + '--approved-plan=<file> (or `-` for stdin, or set F2_APPROVED_PLAN). Nothing was written.',
      );
      process.exitCode = 1;
      return;
    }
    try {
      approvedPlan = loadApprovedPlan(source);
    } catch (error) {
      console.error(`entitlement normalization: APPLY refused the approved plan — ${(error as Error).message}`);
      process.exitCode = 1;
      return;
    }
    // The env-carried aggregate hash stays supported as a SECOND binding: when the release task
    // sets it, it must describe the same artifact, so handing the job the wrong file is caught here
    // rather than after the membership freeze has already picked a company set.
    const declaredHash = argOf(process.argv, '--approved-hash', process.env, 'F2_APPROVED_HASH');
    if (declaredHash !== '' && declaredHash !== approvedPlan.aggregateHash) {
      console.error(
        `entitlement normalization: the approved plan file does not match the approved hash `
        + `(hash=${declaredHash} artifact=${approvedPlan.aggregateHash}). Nothing was written.`,
      );
      process.exitCode = 1;
      return;
    }
  }

  const adapter = new PrismaPg({ connectionString: process.env['DATABASE_URL'] ?? '' });
  const prisma = new PrismaClient({ adapter });
  try {
    if (requireReadOnly) {
      const [proof] = await prisma.$queryRaw<Array<{
        currentUser: string;
        transactionReadOnly: string;
        defaultTransactionReadOnly: string;
        restrictedRole: boolean;
      }>>(Prisma.sql`
        SELECT current_user AS "currentUser",
               current_setting('transaction_read_only') AS "transactionReadOnly",
               current_setting('default_transaction_read_only') AS "defaultTransactionReadOnly",
               COALESCE((SELECT NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole
                                  AND NOT rolreplication AND NOT rolbypassrls
                           FROM pg_roles WHERE rolname = current_user), false) AS "restrictedRole"
      `);
      if (proof?.currentUser !== 'watchdog_a5_ro'
        || proof.transactionReadOnly !== 'on'
        || proof.defaultTransactionReadOnly !== 'on'
        || proof.restrictedRole !== true) {
        throw new Error('F2 read path requires the restricted watchdog_a5_ro session');
      }
    }
    // The normalizer needs only `.client`; PrismaService itself is a Nest provider and is not
    // constructible outside the app context. Same seam as sync-feature-launch-gates.ts.
    const service = { client: prisma } as unknown as PrismaService;
    const runId = `normalize-${process.env['GIT_SHA'] ?? 'local'}-${Date.now()}`;
    console.log(`entitlement normalization: mode=${mode} normalizerVersion=${NORMALIZER_VERSION} runId=${runId}`);

    /** Set by APPLY when companies failed; VERIFY still runs, and both are reported at the end. */
    let applyFailed = false;

    if (mode !== 'verify') {
      // UAT r6/r7 — APPLY re-plans the FROZEN membership read-only first and refuses to proceed
      // unless the result is byte-identical to what the approver reviewed. This pass writes nothing,
      // so an estate that drifted before the run costs a halt, never a half-applied one. Drift that
      // appears AFTER this point is caught per company, under its own lock.
      if (approvedPlan) {
        const preflight = await normalizeAllCompanyEntitlements(service, {
          runId,
          dryRun: true,
          approvedPlanHashes: approvedPlan.planHashes,
        });
        console.log(`entitlement normalization: aggregateHash=${preflight.aggregateHash}`);
        console.log(`entitlement normalization: approvedHash=${approvedPlan.aggregateHash}`);
        if (preflight.aggregateHash !== approvedPlan.aggregateHash) {
          emit(runId, artifactOf('dry-run', runId, preflight));
          console.error(
            `UAT ไม่ผ่าน: the entitlement estate no longer matches the approved artifact `
            + `(approved=${approvedPlan.aggregateHash} recomputed=${preflight.aggregateHash}, `
            + `companies=${preflight.total}). NOTHING was written — review a fresh PLAN artifact `
            + 'and approve that one instead.',
          );
          process.exitCode = 1;
          return;
        }
        console.log('entitlement normalization: approved artifact still describes the estate — applying.');
      }

      const result = await normalizeAllCompanyEntitlements(service, {
        runId,
        dryRun: mode === 'dry-run',
        ...(approvedPlan ? { approvedPlanHashes: approvedPlan.planHashes } : {}),
        log: (message) => console.log(message),
      });
      console.log(
        `entitlement normalization: total=${result.total} `
        + `${mode === 'dry-run' ? 'planned' : 'completed'}=${result.completed} skipped=${result.skipped} `
        + `failed=${result.failed} dependencyExceptions=${result.dependencyExceptions} `
        + `normalizationIncomplete=${result.normalizationIncomplete} `
        + `outsideApprovedPlan=${result.skippedOutsideApprovedPlan.length}`,
      );
      // One grep-able line: the f2-normalize workflow reads exactly this to carry the reviewed hash
      // from the PLAN job into the approval-gated apply job.
      console.log(`entitlement normalization: aggregateHash=${result.aggregateHash}`);
      for (const company of result.companies) {
        const unmet = company.dependencyFindings.filter((finding) => finding.action === 'EXCEPTION');
        if (unmet.length > 0) {
          console.log(
            `entitlement normalization: dependencyException company=${company.companyId} `
            + unmet.map((finding) => `${finding.featureKey}<-${finding.requiresFeatureKey}`).join(','),
          );
        }
      }
      const artifact = artifactOf(mode, runId, result);
      emit(runId, artifact);

      if (mode === 'dry-run') {
        if (!artifact.approvalReady) {
          for (const failure of result.errors) console.error(`  ${failure.companyId}: ${failure.error}`);
          console.error(
            `entitlement normalization: PLAN is NOT approval-ready (failed=${result.failed} `
            + `dependencyExceptions=${result.dependencyExceptions} `
            + `unresolvedCohorts=${artifact.unresolvedCohorts}). The artifact above is complete and `
            + 'reviewable, but APPLY will refuse it: resolve the exception companies and cohort '
            + 'evidence, then re-plan.',
          );
          // `--allow-exceptions` exists so a review job can produce this artifact without failing the
          // pipeline. It never makes the artifact appliable — `approvalReady` stays false.
          if (!allowExceptions) process.exitCode = 1;
          return;
        }
        console.log(
          'entitlement normalization: PLAN — nothing was written. Review the artifact, then run the '
          + 'f2-normalize apply job with F2_APPLY=true and --approved-plan pointing at THIS file '
          + `(aggregateHash=${result.aggregateHash}).`,
        );
        return;
      }

      // APPLY. Per-company transactions already commit independently, so a failure leaves every
      // company that DID complete committed and resumable — never rolled back with it.
      for (const companyId of result.skippedOutsideApprovedPlan) {
        console.error(`  ${companyId}: pending but outside the approved artifact — not applied.`);
      }
      if (result.normalizationIncomplete !== 0 || result.failed !== 0) {
        for (const failure of result.errors) console.error(`  ${failure.companyId}: ${failure.error}`);
        console.error(
          `UAT ไม่ผ่าน: ${result.normalizationIncomplete} company/companies remain normalizationIncomplete `
          + `(failed=${result.failed} dependencyExceptions=${result.dependencyExceptions} `
          + `outsideApprovedPlan=${result.skippedOutsideApprovedPlan.length}). The companies that DID `
          + 'complete are committed; re-run with a fresh reviewed artifact for the rest.',
        );
        applyFailed = true;
      }
    }

    // Ruling 3c — the post-apply step, and a standalone operator command. UAT r7 P0-4 (d): this runs
    // even when companies failed above, because "which companies are actually fine" is the first
    // question after a partial apply and the failure list alone cannot answer it.
    const verified = await verifyCompanyNormalizations(service, { log: (message) => console.log(message) });
    console.log(
      `entitlement normalization: verify total=${verified.total} incomplete=${verified.incomplete} `
      + `drifted=${verified.drifted.length} provenanceGaps=${verified.provenanceGaps.length}`,
    );
    if (verified.incomplete !== 0 || verified.drifted.length > 0 || verified.provenanceGaps.length > 0) {
      for (const drift of verified.drifted) console.error(`  ${drift.companyId}: ${JSON.stringify(drift)}`);
      // A gap here means the grandfather cohort is not fully recorded, so removing the legacy
      // fail-open semantics on day 14 would silently drop access this pass was meant to preserve.
      for (const gap of verified.provenanceGaps) {
        console.error(`  ${gap.companyId}: grantOrigin=LEGACY missing on ${gap.missing.length} effective-ON rows`);
      }
      console.error(
        'UAT ไม่ผ่าน: normalization verify failed — the stored rows are not the normalized fixed point, '
        + 'the cohort was never recorded, or the grandfather provenance stamp did not land.',
      );
      process.exitCode = 1;
    }
    if (applyFailed) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('Entitlement normalization failed:', err);
  process.exit(1);
});
