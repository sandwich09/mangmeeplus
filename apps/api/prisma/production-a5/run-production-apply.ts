/** Exact reviewed production migration task. No service traffic and no AWS task credentials. */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client';
import { sha256, stableJson } from '../../src/scripts/a5-readonly-evidence.logic';
import {
  productionA5ManifestHashes,
  type ProductionA5BudgetObservation,
  type ProductionA5ExecutedMigrationSet,
  type ProductionA5ManifestHashes,
} from '../../src/scripts/production-a5-evidence.logic';
import {
  assertNoProductionA5AwsCredentials,
  readProductionA5AppliedMigrations,
  readProductionA5SchemaObjects,
} from '../../src/scripts/production-a5-evidence.pg';
import { buildProductionA5ReviewedManifestArtifact, readProductionA5RepositoryMigrationFiles } from './reviewed-manifest';
import {
  exactCandidateSet,
  LOCK_TIMEOUT_MS,
  MAX_REHEARSAL_MS,
  reviewedPhase,
  runCaptured,
  STATEMENT_TIMEOUT_MS,
  timedCandidateMigrations,
} from './run-clone-rehearsal';

const RESULT_CHUNK_BYTES = 18_000;

type ChildRef = {
  artifactKind: 'OWNER_U5E_APPROVAL_V1';
  producerRunId: string;
  producerRunAttempt: number;
  artifactName: string;
  contentSha256: string;
  artifactDigest: string;
};

type ProductionApplyAuthority = {
  ownerApprovalRef: ChildRef;
  maintenanceWindow: {
    windowId: string;
    startsAtEpochMs: number;
    endsAtEpochMs: number;
    failurePolicy: 'LEAVE_REIMBURSEMENT_QUIESCED_REQUIRE_FRESH_APPROVAL';
  };
};

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim() ?? '';
  if (value === '') throw new Error(`production_a5_apply_${name.toLowerCase()}_required`);
  return value;
}

export function strictProductionDatabaseUrl(raw: string, expectedHost: string): string {
  const url = new URL(raw);
  if (url.protocol !== 'postgresql:' || url.hostname !== expectedHost
    || (url.port !== '' && url.port !== '5432')
    || !/^watchdog-bms-prod-db\.[a-z0-9.-]+\.rds\.amazonaws\.com$/.test(url.hostname)
    || url.username === '' || url.password === '' || !/^\/[A-Za-z0-9_.-]+$/.test(url.pathname)) {
    throw new Error('production_a5_apply_database_identity_invalid');
  }
  url.port = '5432';
  url.searchParams.set('schema', 'public');
  url.searchParams.set('sslmode', 'verify-full');
  url.searchParams.set('sslrootcert', '/etc/ssl/certs/aws-rds-global-bundle.pem');
  url.searchParams.set('options', `-c lock_timeout=${LOCK_TIMEOUT_MS}ms -c statement_timeout=${STATEMENT_TIMEOUT_MS}ms`);
  return url.toString();
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return stableJson(Object.keys(value).sort()) === stableJson([...keys].sort());
}

export function parseProductionApplyAuthority(raw: string, nowMs: number): ProductionApplyAuthority {
  const value = JSON.parse(raw) as Record<string, any>;
  const ref = value.ownerApprovalRef as Record<string, unknown>;
  const window = value.maintenanceWindow as Record<string, unknown>;
  if (!exactKeys(value, ['ownerApprovalRef', 'maintenanceWindow'])
    || !ref || !exactKeys(ref, ['artifactKind', 'producerRunId', 'producerRunAttempt', 'artifactName', 'contentSha256', 'artifactDigest'])
    || ref.artifactKind !== 'OWNER_U5E_APPROVAL_V1'
    || typeof ref.producerRunId !== 'string' || !/^[1-9][0-9]*$/.test(ref.producerRunId)
    || !Number.isInteger(ref.producerRunAttempt) || Number(ref.producerRunAttempt) < 1
    || typeof ref.artifactName !== 'string' || ref.artifactName === ''
    || typeof ref.contentSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(ref.contentSha256)
    || typeof ref.artifactDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(ref.artifactDigest)
    || !window || !exactKeys(window, ['windowId', 'startsAtEpochMs', 'endsAtEpochMs', 'failurePolicy'])
    || typeof window.windowId !== 'string' || !/^u5e-[1-9][0-9]*-a[1-9][0-9]*-[1-9][0-9]*-a[1-9][0-9]*$/.test(window.windowId)
    || !Number.isInteger(window.startsAtEpochMs) || !Number.isInteger(window.endsAtEpochMs)
    || Number(window.endsAtEpochMs) <= Number(window.startsAtEpochMs)
    || Number(window.endsAtEpochMs) - Number(window.startsAtEpochMs) > MAX_REHEARSAL_MS
    || nowMs < Number(window.startsAtEpochMs) || nowMs > Number(window.endsAtEpochMs)
    || window.failurePolicy !== 'LEAVE_REIMBURSEMENT_QUIESCED_REQUIRE_FRESH_APPROVAL') {
    throw new Error('production_a5_apply_authority_invalid_or_stale');
  }
  return value as ProductionApplyAuthority;
}

function expectedHashes(raw: string): ProductionA5ManifestHashes {
  const value = JSON.parse(raw) as Record<string, unknown>;
  const keys: Array<keyof ProductionA5ManifestHashes> = [
    'candidateMigrationSetHash', 'reviewedMigrationOperationsHash', 'expectedSchemaDeltaHash',
    'expectedDataTransformHash', 'preflightCatalogHash', 'lockBudgetPolicyHash',
    'expectedSeededRouteHash', 'expectedClosedWhtRouteHash',
  ];
  if (!exactKeys(value, keys) || keys.some((key) => (
    typeof value[key] !== 'string' || !/^[0-9a-f]{64}$/.test(value[key] as string)
  ))) throw new Error('production_a5_apply_expected_hashes_invalid');
  return value as ProductionA5ManifestHashes;
}

function assertHashSubset(actual: ProductionA5ManifestHashes, expected: ProductionA5ManifestHashes): void {
  for (const key of Object.keys(expected) as Array<keyof ProductionA5ManifestHashes>) {
    if (key !== 'expectedSchemaDeltaHash' && actual[key] !== expected[key]) {
      throw new Error(`production_a5_apply_reviewed_hash_mismatch:${key}`);
    }
  }
}

function chunks(value: unknown): string[] {
  const bytes = Buffer.from(`${stableJson(value)}\n`, 'utf8');
  const digest = sha256(bytes);
  const encoded = bytes.toString('base64');
  const parts: string[] = [];
  for (let offset = 0; offset < encoded.length; offset += RESULT_CHUNK_BYTES) {
    parts.push(encoded.slice(offset, offset + RESULT_CHUNK_BYTES));
  }
  return parts.map((part, index) => `A5_PRODUCTION_APPLY_RESULT ${index + 1}/${parts.length} ${digest} ${part}`);
}

async function main(): Promise<void> {
  assertNoProductionA5AwsCredentials(process.env);
  const sourceCommit = requiredEnv('SOURCE_SHA');
  const migrationImage = requiredEnv('PRODUCTION_A5_MIGRATION_IMAGE');
  const expectedHost = requiredEnv('PRODUCTION_A5_EXPECTED_DATABASE_HOST');
  const sourceAppliedMigrationsHash = requiredEnv('PRODUCTION_A5_SOURCE_APPLIED_MIGRATIONS_HASH');
  if (!/^[0-9a-f]{40}$/.test(sourceCommit)
    || !/^311414082667\.dkr\.ecr\.ap-southeast-1\.amazonaws\.com\/watchdog-bms-migration-tool@sha256:[0-9a-f]{64}$/.test(migrationImage)
    || !/^[0-9a-f]{64}$/.test(sourceAppliedMigrationsHash)) {
    throw new Error('production_a5_apply_identity_invalid');
  }
  const authority = parseProductionApplyAuthority(requiredEnv('PRODUCTION_A5_APPLY_AUTHORITY_JSON'), Date.now());
  const reviewedHashes = expectedHashes(requiredEnv('PRODUCTION_A5_EXPECTED_HASHES_JSON'));
  const databaseUrl = strictProductionDatabaseUrl(requiredEnv('DATABASE_URL'), expectedHost);
  delete process.env['DATABASE_URL'];
  const files = readProductionA5RepositoryMigrationFiles();
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  try {
    const engine = await client.$queryRawUnsafe<Array<{ version: string }>>(
      "SELECT current_setting('server_version') AS version",
    );
    if (!/^18(?:\.[0-9]+){1,2}$/.test(engine[0]?.version ?? '')) {
      throw new Error('production_a5_apply_postgresql_18_required');
    }
    const sourceApplied = await readProductionA5AppliedMigrations(client);
    if (sha256(stableJson(sourceApplied)) !== sourceAppliedMigrationsHash) {
      throw new Error('production_a5_apply_source_migration_drift');
    }
    const preObjects = await readProductionA5SchemaObjects(client, 'public');
    const provisional = buildProductionA5ReviewedManifestArtifact({
      migrationFiles: files, preSchemaCatalogObjects: preObjects, postSchemaCatalogObjects: preObjects,
    });
    const candidateNames = provisional.reviewedMigrationManifest.map((row) => row.migrationName);
    exactCandidateSet(sourceApplied, files, candidateNames);
    assertHashSubset(productionA5ManifestHashes(provisional), reviewedHashes);
    const preconditionResults = await reviewedPhase(client, provisional, 'PRE');
    parseProductionApplyAuthority(stableJson(authority), Date.now());

    const migrationStartedAt = Date.now();
    runCaptured('pnpm', [
      '--filter', '@watchdog-bms/api', 'exec', 'prisma', 'migrate', 'deploy',
      '--schema', 'prisma/schema.prisma',
    ], { ...process.env, DATABASE_URL: databaseUrl }, '/app');
    if (Date.now() - migrationStartedAt > MAX_REHEARSAL_MS) {
      throw new Error('production_a5_apply_maintenance_window_exceeded');
    }

    const postApplied = await readProductionA5AppliedMigrations(client);
    const expectedPost = [...sourceApplied, ...provisional.reviewedMigrationManifest.map((row, index) => ({
      name: row.migrationName, checksum: row.checksumSha256,
      appliedOrder: sourceApplied.length + index + 1,
    }))];
    if (stableJson(postApplied) !== stableJson(expectedPost)) {
      throw new Error('production_a5_apply_post_migration_ledger_mismatch');
    }
    const postObjects = await readProductionA5SchemaObjects(client, 'public');
    const manifest = buildProductionA5ReviewedManifestArtifact({
      migrationFiles: files, preSchemaCatalogObjects: preObjects, postSchemaCatalogObjects: postObjects,
    });
    const manifestHashes = productionA5ManifestHashes(manifest);
    if (stableJson(manifestHashes) !== stableJson(reviewedHashes)) {
      throw new Error('production_a5_apply_reviewed_manifest_drift');
    }
    const [postSchemaResults, postDataResults] = await Promise.all([
      reviewedPhase(client, manifest, 'POST_SCHEMA'), reviewedPhase(client, manifest, 'POST_DATA'),
    ]);
    const timed = await timedCandidateMigrations(client, candidateNames);
    const windowId = authority.maintenanceWindow.windowId;
    const executionBudgetResults: ProductionA5BudgetObservation[] = timed.map((row) => {
      const started = row.startedAt.getTime();
      const finished = row.finishedAt.getTime();
      if (finished <= started || finished - started > STATEMENT_TIMEOUT_MS
        || started < authority.maintenanceWindow.startsAtEpochMs
        || finished > authority.maintenanceWindow.endsAtEpochMs) {
        throw new Error('production_a5_apply_execution_budget_exceeded');
      }
      return {
        migrationName: row.name, maintenanceWindowId: windowId,
        effectiveLockTimeoutMs: LOCK_TIMEOUT_MS, effectiveStatementTimeoutMs: STATEMENT_TIMEOUT_MS,
        lockTimeoutEnforced: true, statementTimeoutEnforced: true, lockWaitBelowTimeout: true,
        observedStatementDurationMs: finished - started,
        maintenanceWindowStartedAtEpochMs: started, maintenanceWindowFinishedAtEpochMs: finished,
      };
    });
    const executedRows = manifest.reviewedMigrationManifest.map((row, index) => ({
      relativePath: row.relativePath, migrationName: row.migrationName,
      checksumSha256: row.checksumSha256, executionOrder: sourceApplied.length + index + 1,
    }));
    const executedMigrations: ProductionA5ExecutedMigrationSet = {
      status: 'VERIFIED', migrations: executedRows, migrationsHash: sha256(stableJson(executedRows)),
    };
    const result = {
      schemaVersion: 1, status: 'PASSED', sourceCommit, migrationImage,
      sourceAppliedMigrationsHash, manifestHashes, preconditionResults, postSchemaResults,
      postDataResults, executedMigrations, executionBudgetResults,
      executionBudgetResultsHash: sha256(stableJson(executionBudgetResults)),
      reimbursementInvariantHash: sha256(stableJson({ postSchemaResults, postDataResults })),
      productionApplyAuthority: authority,
    };
    for (const line of chunks(result)) process.stdout.write(`${line}\n`);
  } finally {
    await client.$disconnect().catch(() => undefined);
  }
}

if (require.main === module) {
  main().catch(() => {
    console.error('Production A5 apply failed: production_a5_apply_failed');
    process.exitCode = 1;
  });
}
