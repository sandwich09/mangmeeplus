import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PRODUCTION_A5_EXPECTED_CLOSED_WHT_ROUTES,
  PRODUCTION_A5_EXPECTED_SEEDED_ROUTES,
  parseProductionA5ReviewedManifest,
  productionA5MigrationRiskSummary,
  type ProductionA5InvariantExpectation,
  type ProductionA5MigrationFile,
  type ProductionA5ReviewedManifest,
  type ProductionA5SchemaObject,
} from '../../src/scripts/production-a5-evidence.logic';
import { sha256, stableJson } from '../../src/scripts/a5-readonly-evidence.logic';
import {
  PRODUCTION_A5_REVIEWED_MIGRATIONS,
  type ProductionA5ReviewedQueryDefinition,
} from './reviewed-migration-catalog';

const MAX_MIGRATION_BYTES = 8 * 1024 * 1024;
const EXPECTED_RISK_SUMMARY = {
  candidateCount: 42,
  additiveCount: 18,
  backwardCompatibleNonadditiveCount: 12,
  dataBackfillCount: 6,
  blockingContractCount: 6,
  destructiveCustomerDataLossCount: 0,
  manualCustomerInputCount: 0,
  unreviewedCount: 0,
} as const;

export type ProductionA5ReviewedQueryCatalogEntry = ProductionA5ReviewedQueryDefinition & {
  migrationName: string;
  phase: 'PRE' | 'POST_SCHEMA' | 'POST_DATA';
};

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function invariantRef(query: ProductionA5ReviewedQueryDefinition): ProductionA5InvariantExpectation {
  return { id: query.id, queryHash: query.queryHash, expectedResultHash: query.expectedResultHash };
}

export const PRODUCTION_A5_REVIEWED_QUERY_CATALOG: readonly ProductionA5ReviewedQueryCatalogEntry[] =
  PRODUCTION_A5_REVIEWED_MIGRATIONS.flatMap((migration) => [
    ...migration.preconditions.map((query) => ({ migrationName: migration.migrationName, phase: 'PRE' as const, ...query })),
    ...migration.postSchemaInvariants.map((query) => ({
      migrationName: migration.migrationName, phase: 'POST_SCHEMA' as const, ...query,
    })),
    ...migration.postDataInvariants.map((query) => ({
      migrationName: migration.migrationName, phase: 'POST_DATA' as const, ...query,
    })),
  ]).sort((left, right) => compareText(`${left.migrationName}\0${left.phase}\0${left.id}`, `${right.migrationName}\0${right.phase}\0${right.id}`));

export const PRODUCTION_A5_REVIEWED_QUERY_CATALOG_HASH = sha256(stableJson(
  PRODUCTION_A5_REVIEWED_QUERY_CATALOG.map(({ migrationName, phase, id, queryHash, expectedResultHash }) => ({
    migrationName, phase, id, queryHash, expectedResultHash,
  })),
));

export function readProductionA5RepositoryMigrationFiles(
  migrationsDirectory = join(__dirname, '..', 'migrations'),
): ProductionA5MigrationFile[] {
  const entries = readdirSync(migrationsDirectory, { withFileTypes: true });
  if (entries.some((entry) => (
    entry.name === 'migration_lock.toml' ? !entry.isFile() : !entry.isDirectory()
  ))) throw new Error('production_a5_migration_directory_entry_invalid');
  const rows = entries
    .filter((entry) => entry.name !== 'migration_lock.toml')
    .sort((left, right) => compareText(left.name, right.name))
    .map((entry) => {
      if (!/^\d{14}_[a-z0-9_]+$/.test(entry.name)) throw new Error('production_a5_migration_directory_invalid');
      const migrationDirectory = join(migrationsDirectory, entry.name);
      if (readdirSync(migrationDirectory).join('\0') !== 'migration.sql') {
        throw new Error('production_a5_migration_directory_contents_invalid');
      }
      const migrationPath = join(migrationDirectory, 'migration.sql');
      const stat = lstatSync(migrationPath);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > MAX_MIGRATION_BYTES) {
        throw new Error('production_a5_migration_file_invalid');
      }
      const bytes = readFileSync(migrationPath);
      return { name: entry.name, fileSha256: sha256(bytes), sqlBytes: bytes.toString('utf8') };
    });
  if (rows.length === 0) throw new Error('production_a5_migration_directory_empty');
  return rows;
}

function assertCatalog(): void {
  const definitions = [...PRODUCTION_A5_REVIEWED_MIGRATIONS];
  const names = definitions.map((row) => row.migrationName);
  if (new Set(names).size !== names.length
    || names.some((name, index) => index > 0 && names[index - 1]! >= name)) {
    throw new Error('production_a5_reviewed_migration_definitions_not_sorted_unique');
  }
  const queryKeys = PRODUCTION_A5_REVIEWED_QUERY_CATALOG.map((row) => `${row.migrationName}\0${row.phase}\0${row.id}`);
  if (new Set(queryKeys).size !== queryKeys.length
    || PRODUCTION_A5_REVIEWED_QUERY_CATALOG.some((row) => row.queryHash !== sha256(row.sql)
      || row.sql.includes(';') || !/^SELECT\s/i.test(row.sql)
      || /\b(?:INSERT|UPDATE|DELETE|MERGE|ALTER|CREATE|DROP|TRUNCATE|GRANT|REVOKE|CALL|COPY)\b/i.test(row.sql))) {
    throw new Error('production_a5_reviewed_query_catalog_invalid');
  }
}

export function buildProductionA5ReviewedManifestArtifact(input: {
  migrationFiles: readonly ProductionA5MigrationFile[];
  preSchemaCatalogObjects: ProductionA5SchemaObject[];
  postSchemaCatalogObjects: ProductionA5SchemaObject[];
}): ProductionA5ReviewedManifest {
  assertCatalog();
  const byName = new Map(input.migrationFiles.map((file) => [file.name, file]));
  const reviewedMigrationManifest = PRODUCTION_A5_REVIEWED_MIGRATIONS.map((definition) => {
    const file = byName.get(definition.migrationName);
    if (!file) throw new Error(`production_a5_reviewed_migration_file_missing:${definition.migrationName}`);
    return {
      relativePath: `apps/api/prisma/migrations/${definition.migrationName}/migration.sql`,
      migrationName: definition.migrationName,
      checksumSha256: file.fileSha256,
      operationClass: definition.operationClass,
      preconditions: definition.preconditions.map(invariantRef),
      executionBudget: {
        lockTimeoutMs: definition.migrationName === '20260801150000_drift_forward_fix' ? 5_000 : 2_000,
        statementTimeoutMs: 300_000,
      },
      postSchemaInvariants: definition.postSchemaInvariants.map(invariantRef),
      postDataInvariants: definition.postDataInvariants.map(invariantRef),
    };
  });
  const candidateNames = new Set(reviewedMigrationManifest.map((row) => row.migrationName));
  const candidateFiles = input.migrationFiles.filter((file) => candidateNames.has(file.name));
  if (candidateFiles.length !== reviewedMigrationManifest.length) {
    throw new Error('production_a5_reviewed_candidate_file_set_mismatch');
  }
  const raw = {
    schemaVersion: 3,
    catalogScope: {
      version: 1,
      schema: 'public',
      objectKinds: ['COLUMN', 'CONSTRAINT', 'ENUM_VALUE', 'INDEX', 'RELATION'],
    },
    reviewedMigrationManifest,
    preSchemaCatalogObjects: input.preSchemaCatalogObjects,
    postSchemaCatalogObjects: input.postSchemaCatalogObjects,
    expectedSeededRoutes: PRODUCTION_A5_EXPECTED_SEEDED_ROUTES,
    expectedClosedWhtRoutes: PRODUCTION_A5_EXPECTED_CLOSED_WHT_ROUTES,
  };
  const parsed = parseProductionA5ReviewedManifest(raw, input.migrationFiles);
  if (stableJson(productionA5MigrationRiskSummary(parsed)) !== stableJson(EXPECTED_RISK_SUMMARY)) {
    throw new Error('production_a5_reviewed_migration_classification_drift');
  }
  return parsed;
}
