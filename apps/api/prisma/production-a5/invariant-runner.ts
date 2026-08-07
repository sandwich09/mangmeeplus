import type { Prisma } from '../../src/generated/prisma/client';
import { sha256, stableJson } from '../../src/scripts/a5-readonly-evidence.logic';
import {
  parseProductionA5VerificationEvidence,
  productionA5ManifestHashes,
  type ProductionA5BudgetObservation,
  type ProductionA5CloneChildRef,
  type ProductionA5CloneRehearsal,
  type ProductionA5ExecutedMigrationSet,
  type ProductionA5InvariantResult,
  type ProductionA5InvariantResultSet,
  type ProductionA5ReviewedManifest,
  type ProductionA5VerificationEvidence,
} from '../../src/scripts/production-a5-evidence.logic';
import { PRODUCTION_A5_REVIEWED_QUERY_CATALOG } from './reviewed-manifest';

export type ProductionA5InvariantPhase = 'PRE' | 'POST_SCHEMA' | 'POST_DATA';
export type ProductionA5InvariantReadClient = Pick<Prisma.TransactionClient, '$queryRawUnsafe'>;

const NOT_RUN = { status: 'NOT_RUN' as const, results: null, resultsHash: null };
const EXECUTION_NOT_RUN = { status: 'NOT_RUN' as const, migrations: null, migrationsHash: null };

function hash(value: unknown): string {
  return sha256(stableJson(value));
}

function expectedResults(
  manifest: ProductionA5ReviewedManifest,
  phase: ProductionA5InvariantPhase,
): Array<Omit<ProductionA5InvariantResult, 'actualResultHash'>> {
  const key = phase === 'PRE' ? 'preconditions'
    : phase === 'POST_SCHEMA' ? 'postSchemaInvariants' : 'postDataInvariants';
  return manifest.reviewedMigrationManifest.flatMap((migration) => migration[key].map((query) => ({
    migrationName: migration.migrationName,
    ...query,
  })));
}

/** Executes only the immutable reviewed SELECT catalog; callers cannot supply SQL. */
export async function runProductionA5ReviewedInvariantPhase(
  client: ProductionA5InvariantReadClient,
  manifest: ProductionA5ReviewedManifest,
  phase: ProductionA5InvariantPhase,
): Promise<ProductionA5InvariantResultSet> {
  const expected = expectedResults(manifest, phase);
  const queries = PRODUCTION_A5_REVIEWED_QUERY_CATALOG.filter((row) => row.phase === phase);
  const catalogRefs = queries.map(({ migrationName, id, queryHash, expectedResultHash }) => ({
    migrationName, id, queryHash, expectedResultHash,
  }));
  if (stableJson(catalogRefs) !== stableJson(expected)) {
    throw new Error(`production_a5_${phase.toLowerCase()}_reviewed_query_catalog_mismatch`);
  }

  const results: ProductionA5InvariantResult[] = [];
  for (const query of queries) {
    if (query.queryHash !== sha256(query.sql)) {
      throw new Error('production_a5_reviewed_query_bytes_mismatch');
    }
    const rows = await client.$queryRawUnsafe<unknown[]>(query.sql);
    const actualResultHash = hash(rows);
    if (actualResultHash !== query.expectedResultHash) {
      throw new Error(`production_a5_invariant_failed:${query.migrationName}:${query.id}`);
    }
    results.push({
      migrationName: query.migrationName,
      id: query.id,
      queryHash: query.queryHash,
      expectedResultHash: query.expectedResultHash,
      actualResultHash,
    });
  }
  return { status: 'VERIFIED', results, resultsHash: hash(results) };
}

export function buildProductionA5CloneRehearsal(input: {
  manifest: ProductionA5ReviewedManifest;
  engineVersion: string;
  sourceDatabaseFingerprint: string;
  sourceAppliedMigrationsHash: string;
  preconditionResults: ProductionA5InvariantResultSet;
  postSchemaResults: ProductionA5InvariantResultSet;
  postDataResults: ProductionA5InvariantResultSet;
  executedMigrations: ProductionA5ExecutedMigrationSet;
  executionBudgetResults: ProductionA5BudgetObservation[];
  cleanup: ProductionA5CloneRehearsal['cleanup'];
}): ProductionA5CloneRehearsal {
  const hashes = productionA5ManifestHashes(input.manifest);
  const facts = {
    result: 'PASSED' as const,
    engine: 'PostgreSQL' as const,
    engineVersion: input.engineVersion,
    sourceDatabaseFingerprint: input.sourceDatabaseFingerprint,
    sourceAppliedMigrationsHash: input.sourceAppliedMigrationsHash,
    sourceSchemaCatalogFingerprint: hash(input.manifest.preSchemaCatalogObjects),
    resultSchemaCatalogFingerprint: hash(input.manifest.postSchemaCatalogObjects),
    reviewedMigrationOperationsHash: hashes.reviewedMigrationOperationsHash,
    expectedSchemaDeltaHash: hashes.expectedSchemaDeltaHash,
    expectedDataTransformHash: hashes.expectedDataTransformHash,
    preconditionResults: input.preconditionResults,
    postSchemaResults: input.postSchemaResults,
    postDataResults: input.postDataResults,
    executedMigrations: input.executedMigrations,
    executionBudgetResults: input.executionBudgetResults,
    executionBudgetResultsHash: hash(input.executionBudgetResults),
    cleanup: input.cleanup,
  };
  return { ...facts, resultHash: hash(facts) };
}

export function buildProductionA5PreVerificationEvidence(input: {
  manifest: ProductionA5ReviewedManifest;
  sourceAppliedMigrationsHash: string;
  preconditionResults: ProductionA5InvariantResultSet;
  cloneRehearsal: ProductionA5CloneRehearsal;
  cloneRehearsalRef: ProductionA5CloneChildRef;
}): ProductionA5VerificationEvidence {
  return parseProductionA5VerificationEvidence({
    cloneRehearsalRef: input.cloneRehearsalRef,
    preconditionResults: input.preconditionResults,
    postSchemaResults: NOT_RUN,
    postDataResults: NOT_RUN,
    executedMigrations: EXECUTION_NOT_RUN,
    executionBudgetResults: input.cloneRehearsal.executionBudgetResults,
    executionBudgetResultsHash: input.cloneRehearsal.executionBudgetResultsHash,
    cloneRehearsal: input.cloneRehearsal,
  }, 'PRE_MUTATION', input.manifest, input.sourceAppliedMigrationsHash);
}

export function buildProductionA5PostVerificationEvidence(input: {
  manifest: ProductionA5ReviewedManifest;
  sourceAppliedMigrationsHash: string;
  preMutationVerificationEvidence: unknown;
  postSchemaResults: ProductionA5InvariantResultSet;
  postDataResults: ProductionA5InvariantResultSet;
  executedMigrations: ProductionA5ExecutedMigrationSet;
  executionBudgetResults: ProductionA5BudgetObservation[];
}): ProductionA5VerificationEvidence {
  const pre = parseProductionA5VerificationEvidence(
    input.preMutationVerificationEvidence,
    'PRE_MUTATION',
    input.manifest,
    input.sourceAppliedMigrationsHash,
  );
  return parseProductionA5VerificationEvidence({
    cloneRehearsalRef: pre.cloneRehearsalRef,
    preconditionResults: pre.preconditionResults,
    postSchemaResults: input.postSchemaResults,
    postDataResults: input.postDataResults,
    executedMigrations: input.executedMigrations,
    executionBudgetResults: input.executionBudgetResults,
    executionBudgetResultsHash: hash(input.executionBudgetResults),
    cloneRehearsal: pre.cloneRehearsal,
  }, 'POST_MIGRATION', input.manifest, input.sourceAppliedMigrationsHash);
}

export function validateProductionA5PostDeploymentVerificationEvidence(input: {
  manifest: ProductionA5ReviewedManifest;
  sourceAppliedMigrationsHash: string;
  postMigrationVerificationEvidence: unknown;
}): ProductionA5VerificationEvidence {
  return parseProductionA5VerificationEvidence(
    input.postMigrationVerificationEvidence,
    'POST_DEPLOYMENT',
    input.manifest,
    input.sourceAppliedMigrationsHash,
  );
}
