/** Generic V2 rehearsal for the exact append-only migration suffix accepted by UAT. */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client';
import { sha256, stableJson } from '../../src/scripts/a5-readonly-evidence.logic';
import {
  assertNoProductionA5AwsCredentials,
  readProductionA5AppliedMigrations,
  readProductionA5SchemaObjects,
} from '../../src/scripts/production-a5-evidence.pg';
import {
  assertAutomaticPendingMigrationSafety,
  compatibleAppliedMigrationCatalog,
} from '../verify-applied-migration-catalog';
import { readProductionA5RepositoryMigrationFiles } from './reviewed-manifest';
import {
  chunkCloneResult,
  MAX_REHEARSAL_MS,
  PRODUCTION_A5_REIMBURSEMENT_COMMAND,
  runCaptured,
  strictCloneUrlFromPgEnvironment,
  timedCandidateMigrations,
} from './run-clone-rehearsal';

function required(name: string): string {
  const value = process.env[name]?.trim() ?? '';
  if (value === '') throw new Error(`production_readiness_clone_${name.toLowerCase()}_required`);
  return value;
}

async function main(): Promise<void> {
  if (process.env['DATABASE_URL'] || process.env['PRODUCTION_A5_CLONE_DATABASE_URL']) {
    throw new Error('production_readiness_clone_unbound_database_url_present');
  }
  assertNoProductionA5AwsCredentials(process.env);
  const sourceCommit = required('GIT_SHA');
  const expectedPendingHash = required('PRODUCTION_READY_EXPECTED_PENDING_CATALOG_HASH');
  const expectedPendingCount = Number(required('PRODUCTION_READY_EXPECTED_PENDING_COUNT'));
  if (!/^[0-9a-f]{40}$/.test(sourceCommit)
    || !/^[0-9a-f]{64}$/.test(expectedPendingHash)
    || !Number.isSafeInteger(expectedPendingCount) || expectedPendingCount < 1) {
    throw new Error('production_readiness_clone_expected_pending_invalid');
  }
  const databaseUrl = strictCloneUrlFromPgEnvironment(
    process.env,
    required('PRODUCTION_A5_EXPECTED_CLONE_HOST'),
  );
  for (const name of ['PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE']) {
    delete process.env[name];
  }
  const files = readProductionA5RepositoryMigrationFiles();
  const repository = files.map((file) => ({ name: file.name, fileSha256: file.fileSha256 }));
  const repositoryCatalogHash = sha256(stableJson(
    repository.map(({ name, fileSha256 }) => ({ name, checksum: fileSha256 })),
  ));
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  try {
    const engineRows = await client.$queryRawUnsafe<Array<{ version: string }>>(
      "SELECT current_setting('server_version') AS version",
    );
    const engineVersion = engineRows[0]?.version ?? '';
    if (!/^18(?:\.[0-9]+){1,2}$/.test(engineVersion)) {
      throw new Error('production_readiness_clone_postgresql_18_required');
    }
    const sourceAppliedMigrations = await readProductionA5AppliedMigrations(client);
    const classification = compatibleAppliedMigrationCatalog({
      repository,
      applied: sourceAppliedMigrations,
      sourceCommit,
    });
    if (classification.status !== 'APPEND_ONLY_PENDING'
      || classification.pendingMigrationCount !== expectedPendingCount
      || classification.pendingCatalogHash !== expectedPendingHash
      || classification.repositoryCatalogHash !== repositoryCatalogHash) {
      throw new Error('production_readiness_clone_catalog_drift');
    }
    assertAutomaticPendingMigrationSafety({
      repository: files,
      appliedMigrationCount: sourceAppliedMigrations.length,
    });
    const pendingMigrations = repository.slice(sourceAppliedMigrations.length)
      .map(({ name, fileSha256 }) => ({ name, checksum: fileSha256 }));
    const preSchemaFingerprint = sha256(stableJson(
      await readProductionA5SchemaObjects(client, 'public'),
    ));

    const startedAtEpochMs = Date.now();
    runCaptured('/app/apps/api/node_modules/.bin/prisma', [
      'migrate', 'deploy',
      '--schema', 'prisma/schema.prisma',
    ], { ...process.env, DATABASE_URL: databaseUrl }, '/app/apps/api');
    const finishedAtEpochMs = Date.now();
    if (finishedAtEpochMs <= startedAtEpochMs
      || finishedAtEpochMs - startedAtEpochMs > MAX_REHEARSAL_MS) {
      throw new Error('production_readiness_clone_migration_window_invalid');
    }

    const postAppliedMigrations = await readProductionA5AppliedMigrations(client);
    const expectedPost = repository.map(({ name, fileSha256 }, index) => ({
      name,
      checksum: fileSha256,
      appliedOrder: index + 1,
    }));
    if (stableJson(postAppliedMigrations) !== stableJson(expectedPost)) {
      throw new Error('production_readiness_clone_post_ledger_mismatch');
    }
    const timed = await timedCandidateMigrations(
      client,
      pendingMigrations.map(({ name }) => name),
    );
    const migrationDurations = timed.map((row) => ({
      name: row.name,
      checksum: row.checksum,
      durationMs: row.finishedAt.getTime() - row.startedAt.getTime(),
    }));
    if (migrationDurations.some((row) => row.durationMs <= 0 || row.durationMs > 300_000)) {
      throw new Error('production_readiness_clone_statement_budget_exceeded');
    }
    runCaptured('/app/apps/api/node_modules/.bin/prisma', [
      'validate',
      '--schema', 'prisma/schema.prisma',
    ], { ...process.env, DATABASE_URL: databaseUrl }, '/app/apps/api');
    const compatibility = runCaptured(
      '/app/node_modules/.bin/tsx', [
        '--test', '--test-reporter=spec',
        'src/scripts/production-a5-reimbursement-compatibility.pg.spec.ts',
        'src/modules/reimbursements/infrastructure/prisma-reimbursement.repository.draft-submit-race.spec.ts',
      ],
      { ...process.env, DATABASE_URL: databaseUrl, REIMBURSEMENT_PG_GATE_REQUIRED: 'true' },
      '/app/apps/api',
    );
    const postSchemaFingerprint = sha256(stableJson(
      await readProductionA5SchemaObjects(client, 'public'),
    ));
    const result = {
      schemaVersion: 2,
      sourceCommit,
      status: 'PASSED',
      engine: 'PostgreSQL',
      engineVersion,
      repositoryCatalogHash,
      sourceAppliedMigrationsHash: sha256(stableJson(sourceAppliedMigrations)),
      pendingMigrations,
      pendingCatalogHash: expectedPendingHash,
      executedMigrations: migrationDurations,
      postAppliedMigrationsHash: sha256(stableJson(postAppliedMigrations)),
      preSchemaFingerprint,
      postSchemaFingerprint,
      migrateDeploy: {
        startedAtEpochMs,
        finishedAtEpochMs,
        durationMs: finishedAtEpochMs - startedAtEpochMs,
        maxDurationMs: MAX_REHEARSAL_MS,
      },
      schemaValidation: { status: 'PASSED' },
      compatibility: {
        status: 'PASSED',
        commandSha256: sha256(PRODUCTION_A5_REIMBURSEMENT_COMMAND),
        outputSha256: sha256(Buffer.concat([compatibility.stdout, compatibility.stderr])),
      },
    };
    for (const line of chunkCloneResult(result)) process.stdout.write(`${line}\n`);
  } finally {
    await client.$disconnect().catch(() => undefined);
  }
}

if (require.main === module) {
  main().catch(() => {
    console.error('Production release readiness clone failed: production_readiness_clone_failed');
    process.exitCode = 1;
  });
}
