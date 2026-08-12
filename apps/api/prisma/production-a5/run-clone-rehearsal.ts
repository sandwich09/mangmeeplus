/** One-shot, aggregate-only rehearsal inside an isolated PostgreSQL 18 snapshot clone. */
import { spawnSync } from 'node:child_process';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client';
import { sha256, stableJson } from '../../src/scripts/a5-readonly-evidence.logic';
import {
  productionA5ManifestHashes,
  type ProductionA5BudgetObservation,
  type ProductionA5ExecutedMigrationSet,
  type ProductionA5MigrationIdentity,
} from '../../src/scripts/production-a5-evidence.logic';
import {
  assertNoProductionA5AwsCredentials,
  readProductionA5AppliedMigrations,
  readProductionA5SchemaObjects,
} from '../../src/scripts/production-a5-evidence.pg';
import {
  buildProductionA5ReviewedManifestArtifact,
  readProductionA5RepositoryMigrationFiles,
} from './reviewed-manifest';
import { runProductionA5ReviewedInvariantPhase } from './invariant-runner';

export const LOCK_TIMEOUT_MS = 2_000;
export const STATEMENT_TIMEOUT_MS = 300_000;
export const MAX_REHEARSAL_MS = 30 * 60_000;
const CHILD_MAX_BUFFER = 16 * 1024 * 1024;
const RESULT_CHUNK_BYTES = 18_000;

export const PRODUCTION_A5_REIMBURSEMENT_COMMAND =
  'cd /app/apps/api && REIMBURSEMENT_PG_GATE_REQUIRED=true '
  + '/app/node_modules/.bin/tsx --test '
  + '--test-reporter=spec src/scripts/production-a5-reimbursement-compatibility.pg.spec.ts '
  + 'src/modules/reimbursements/infrastructure/prisma-reimbursement.repository.draft-submit-race.spec.ts';

const PRODUCTION_A5_REIMBURSEMENT_ARGS = [
  '--test', '--test-reporter=spec',
  'src/scripts/production-a5-reimbursement-compatibility.pg.spec.ts',
  'src/modules/reimbursements/infrastructure/prisma-reimbursement.repository.draft-submit-race.spec.ts',
] as const;

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim() ?? '';
  if (value === '') throw new Error(`production_a5_clone_${name.toLowerCase()}_required`);
  return value;
}

function hash(value: unknown): string {
  return sha256(stableJson(value));
}

export function strictCloneUrlFromPgEnvironment(
  env: Readonly<Record<string, string | undefined>>,
  expectedHost: string,
): string {
  const value = (name: 'PGHOST' | 'PGPORT' | 'PGUSER' | 'PGPASSWORD' | 'PGDATABASE'): string => {
    const result = env[name] ?? '';
    if (result === '') throw new Error(`production_a5_clone_${name.toLowerCase()}_required`);
    return result;
  };
  const host = value('PGHOST');
  const port = value('PGPORT');
  const username = value('PGUSER');
  const password = value('PGPASSWORD');
  const database = value('PGDATABASE');
  if (host !== expectedHost || port !== '5432'
    || !/^watchdog-a5-clone-[a-z0-9-]+\.[a-z0-9]+\.ap-southeast-1\.rds\.amazonaws\.com$/.test(host)) {
    throw new Error('production_a5_clone_database_host_invalid');
  }
  if (!/^[A-Za-z][A-Za-z0-9_]{0,62}$/.test(username)
    || !/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,62}$/.test(database)
    || password.includes('\0') || Buffer.byteLength(password) > 4096) {
    throw new Error('production_a5_clone_database_identity_invalid');
  }
  const url = new URL('postgresql://placeholder:placeholder@localhost/postgres');
  url.hostname = host;
  url.port = port;
  url.username = username;
  url.password = password;
  url.pathname = `/${database}`;
  url.searchParams.set('schema', 'public');
  url.searchParams.set('sslmode', 'verify-full');
  url.searchParams.set('sslrootcert', '/etc/ssl/certs/aws-rds-global-bundle.pem');
  url.searchParams.set('options', `-c lock_timeout=${LOCK_TIMEOUT_MS}ms -c statement_timeout=${STATEMENT_TIMEOUT_MS}ms`);
  return url.toString();
}

export function exactCandidateSet(
  source: readonly ProductionA5MigrationIdentity[],
  files: ReturnType<typeof readProductionA5RepositoryMigrationFiles>,
  candidateNames: readonly string[],
): void {
  const repository = new Map(files.map((file) => [file.name, file.fileSha256]));
  const sourceNames = new Set<string>();
  for (const row of source) {
    if (sourceNames.has(row.name) || repository.get(row.name) !== row.checksum) {
      throw new Error('production_a5_clone_source_migration_ledger_mismatch');
    }
    sourceNames.add(row.name);
  }
  const pending = files.filter((file) => !sourceNames.has(file.name)).map((file) => file.name);
  if (stableJson(pending) !== stableJson(candidateNames)) {
    throw new Error('production_a5_clone_pending_set_not_exactly_reviewed');
  }
}

type TimedMigration = {
  name: string;
  checksum: string;
  startedAt: Date;
  finishedAt: Date;
};

export async function timedCandidateMigrations(
  client: PrismaClient,
  candidateNames: readonly string[],
): Promise<TimedMigration[]> {
  const rows = await client.$queryRawUnsafe<Array<{
    name: string;
    checksum: string;
    startedAt: Date;
    finishedAt: Date | null;
    rolledBackAt: Date | null;
  }>>(`
    SELECT migration_name AS name, checksum, started_at AS "startedAt",
           finished_at AS "finishedAt", rolled_back_at AS "rolledBackAt"
      FROM "_prisma_migrations"
     WHERE migration_name = ANY($1::text[])
     ORDER BY started_at, id
  `, candidateNames);
  if (rows.length !== candidateNames.length || rows.some((row) => (
    row.finishedAt === null || row.rolledBackAt !== null
  ))) throw new Error('production_a5_clone_candidate_migration_history_invalid');
  const byName = new Map(rows.map((row) => [row.name, row]));
  return candidateNames.map((name) => {
    const row = byName.get(name);
    if (!row || row.finishedAt === null) throw new Error('production_a5_clone_candidate_migration_missing');
    return { name: row.name, checksum: row.checksum, startedAt: row.startedAt, finishedAt: row.finishedAt };
  });
}

export function runCaptured(command: string, args: string[], env: NodeJS.ProcessEnv, cwd: string): {
  stdout: Buffer;
  stderr: Buffer;
} {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: 'buffer',
    timeout: MAX_REHEARSAL_MS,
    maxBuffer: CHILD_MAX_BUFFER,
    killSignal: 'SIGKILL',
  });
  if (result.error || result.status !== 0 || result.signal !== null) {
    throw new Error('production_a5_clone_child_command_failed');
  }
  return { stdout: result.stdout ?? Buffer.alloc(0), stderr: result.stderr ?? Buffer.alloc(0) };
}

export function reimbursementCompatibilityFromOutput(stdout: Buffer, stderr: Buffer): {
  command: string;
  commandSha256: string;
  combinedOutputSha256: string;
  databaseUrlBinding: 'DATABASE_URL';
  requiredGate: 'REIMBURSEMENT_PG_GATE_REQUIRED=true';
  suites: 2;
  tests: 13;
  pass: 13;
  skipped: 0;
  status: 'PASSED';
} {
  const combined = Buffer.concat([stdout, stderr]);
  const summary = combined.toString('utf8');
  const count = (label: string): number | null => {
    const match = new RegExp(`(?:^|\\n)\\s*ℹ?\\s*${label}\\s+(\\d+)\\s*(?:\\n|$)`, 'm').exec(summary);
    return match ? Number(match[1]) : null;
  };
  if (count('suites') !== 2 || count('tests') !== 13 || count('pass') !== 13
    || count('fail') !== 0 || count('skipped') !== 0) {
    throw new Error('production_a5_clone_reimbursement_summary_invalid');
  }
  return {
    command: PRODUCTION_A5_REIMBURSEMENT_COMMAND,
    commandSha256: sha256(PRODUCTION_A5_REIMBURSEMENT_COMMAND),
    combinedOutputSha256: sha256(combined),
    databaseUrlBinding: 'DATABASE_URL',
    requiredGate: 'REIMBURSEMENT_PG_GATE_REQUIRED=true',
    suites: 2,
    tests: 13,
    pass: 13,
    skipped: 0,
    status: 'PASSED',
  };
}

export function chunkCloneResult(value: unknown): string[] {
  const bytes = Buffer.from(`${stableJson(value)}\n`, 'utf8');
  const digest = sha256(bytes);
  const encoded = bytes.toString('base64');
  const chunks: string[] = [];
  for (let offset = 0; offset < encoded.length; offset += RESULT_CHUNK_BYTES) {
    chunks.push(encoded.slice(offset, offset + RESULT_CHUNK_BYTES));
  }
  return chunks.map((chunk, index) => (
    `A5_CLONE_RESULT ${index + 1}/${chunks.length} ${digest} ${chunk}`
  ));
}

async function setAndVerifyStrictDatabaseDefaults(client: PrismaClient): Promise<void> {
  const rows = await client.$queryRawUnsafe<Array<{ databaseName: string }>>(
    'SELECT current_database() AS "databaseName"',
  );
  const databaseName = rows[0]?.databaseName ?? '';
  if (!/^[A-Za-z0-9_-]{1,63}$/.test(databaseName)) {
    throw new Error('production_a5_clone_database_name_invalid');
  }
  const quoted = `"${databaseName.replaceAll('"', '""')}"`;
  await client.$executeRawUnsafe(`ALTER DATABASE ${quoted} SET lock_timeout = '${LOCK_TIMEOUT_MS}ms'`);
  await client.$executeRawUnsafe(`ALTER DATABASE ${quoted} SET statement_timeout = '${STATEMENT_TIMEOUT_MS}ms'`);
  const settings = await client.$queryRawUnsafe<Array<{ lockMs: number; statementMs: number }>>(`
    SELECT extract(epoch FROM current_setting('lock_timeout')::interval)::int * 1000 AS "lockMs",
           extract(epoch FROM current_setting('statement_timeout')::interval)::int * 1000 AS "statementMs"
  `);
  if (Number(settings[0]?.lockMs) !== LOCK_TIMEOUT_MS
    || Number(settings[0]?.statementMs) !== STATEMENT_TIMEOUT_MS) {
    throw new Error('production_a5_clone_strict_timeout_policy_not_effective');
  }
}

export async function reviewedPhase(client: PrismaClient, manifest: ReturnType<
typeof buildProductionA5ReviewedManifestArtifact>, phase: 'PRE' | 'POST_SCHEMA' | 'POST_DATA') {
  return client.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    await tx.$executeRawUnsafe('SET LOCAL search_path = pg_catalog, public');
    await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT_MS}ms'`);
    await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT_MS}ms'`);
    return runProductionA5ReviewedInvariantPhase(tx, manifest, phase);
  }, { maxWait: 10_000, timeout: STATEMENT_TIMEOUT_MS + 20_000 });
}

async function main(): Promise<void> {
  if (process.env['DATABASE_URL']) throw new Error('production_a5_clone_unbound_database_url_present');
  if (process.env['PRODUCTION_A5_CLONE_DATABASE_URL']) {
    throw new Error('production_a5_clone_url_secret_forbidden');
  }
  assertNoProductionA5AwsCredentials(process.env);
  const expectedHost = requiredEnv('PRODUCTION_A5_EXPECTED_CLONE_HOST');
  const databaseUrl = strictCloneUrlFromPgEnvironment(process.env, expectedHost);
  for (const name of ['PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE']) {
    delete process.env[name];
  }
  const windowId = requiredEnv('PRODUCTION_A5_CLONE_WINDOW_ID');
  if (!/^a5-clone-[1-9][0-9]*-a[1-9][0-9]*$/.test(windowId)) {
    throw new Error('production_a5_clone_window_id_invalid');
  }
  const files = readProductionA5RepositoryMigrationFiles();
  let client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  try {
    await setAndVerifyStrictDatabaseDefaults(client);
    await client.$disconnect();
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
    await setAndVerifyStrictDatabaseDefaults(client);

    const engineRows = await client.$queryRawUnsafe<Array<{ version: string }>>(
      "SELECT current_setting('server_version') AS version",
    );
    const engineVersion = engineRows[0]?.version ?? '';
    if (!/^18(?:\.[0-9]+){1,2}$/.test(engineVersion)) {
      throw new Error('production_a5_clone_postgresql_18_required');
    }

    const sourceAppliedMigrations = await readProductionA5AppliedMigrations(client);
    const preSchemaCatalogObjects = await readProductionA5SchemaObjects(client, 'public');
    const provisionalManifest = buildProductionA5ReviewedManifestArtifact({
      migrationFiles: files,
      preSchemaCatalogObjects,
      postSchemaCatalogObjects: preSchemaCatalogObjects,
    });
    const candidateNames = provisionalManifest.reviewedMigrationManifest.map((row) => row.migrationName);
    exactCandidateSet(sourceAppliedMigrations, files, candidateNames);
    const preconditionResults = await reviewedPhase(client, provisionalManifest, 'PRE');

    const migrationStart = Date.now();
    runCaptured('/app/apps/api/node_modules/.bin/prisma', [
      'migrate', 'deploy',
      '--schema', 'prisma/schema.prisma',
    ], { ...process.env, DATABASE_URL: databaseUrl }, '/app/apps/api');
    const migrationFinish = Date.now();
    if (migrationFinish - migrationStart > MAX_REHEARSAL_MS) {
      throw new Error('production_a5_clone_rehearsal_window_exceeded');
    }

    const postAppliedMigrations = await readProductionA5AppliedMigrations(client);
    const expectedPost = [
      ...sourceAppliedMigrations,
      ...provisionalManifest.reviewedMigrationManifest.map((row, index) => ({
        name: row.migrationName,
        checksum: row.checksumSha256,
        appliedOrder: sourceAppliedMigrations.length + index + 1,
      })),
    ];
    if (stableJson(postAppliedMigrations) !== stableJson(expectedPost)) {
      throw new Error('production_a5_clone_post_migration_ledger_mismatch');
    }

    const reimbursementRun = runCaptured(
      '/app/node_modules/.bin/tsx', [...PRODUCTION_A5_REIMBURSEMENT_ARGS],
      {
        ...process.env,
        DATABASE_URL: databaseUrl,
        REIMBURSEMENT_PG_GATE_REQUIRED: 'true',
      },
      '/app/apps/api',
    );
    const reimbursementCompatibility = reimbursementCompatibilityFromOutput(
      reimbursementRun.stdout,
      reimbursementRun.stderr,
    );

    const postSchemaCatalogObjects = await readProductionA5SchemaObjects(client, 'public');
    const reviewedManifest = buildProductionA5ReviewedManifestArtifact({
      migrationFiles: files,
      preSchemaCatalogObjects,
      postSchemaCatalogObjects,
    });
    if (stableJson(reviewedManifest.reviewedMigrationManifest)
      !== stableJson(provisionalManifest.reviewedMigrationManifest)) {
      throw new Error('production_a5_clone_reviewed_operation_drift');
    }
    const [postSchemaResults, postDataResults] = await Promise.all([
      reviewedPhase(client, reviewedManifest, 'POST_SCHEMA'),
      reviewedPhase(client, reviewedManifest, 'POST_DATA'),
    ]);

    const timed = await timedCandidateMigrations(client, candidateNames);
    const executionBudgetResults: ProductionA5BudgetObservation[] = timed.map((row) => {
      const started = row.startedAt.getTime();
      const finished = row.finishedAt.getTime();
      if (finished <= started || finished - started > STATEMENT_TIMEOUT_MS) {
        throw new Error('production_a5_clone_migration_duration_exceeded');
      }
      return {
        migrationName: row.name,
        maintenanceWindowId: windowId,
        effectiveLockTimeoutMs: LOCK_TIMEOUT_MS,
        effectiveStatementTimeoutMs: STATEMENT_TIMEOUT_MS,
        lockTimeoutEnforced: true,
        statementTimeoutEnforced: true,
        lockWaitBelowTimeout: true,
        observedStatementDurationMs: finished - started,
        maintenanceWindowStartedAtEpochMs: started,
        maintenanceWindowFinishedAtEpochMs: finished,
      };
    });
    const windowStart = Math.min(...executionBudgetResults.map((row) => row.maintenanceWindowStartedAtEpochMs));
    const windowFinish = Math.max(...executionBudgetResults.map((row) => row.maintenanceWindowFinishedAtEpochMs));
    if (windowFinish - windowStart > MAX_REHEARSAL_MS) {
      throw new Error('production_a5_clone_rehearsal_window_exceeded');
    }
    const executedRows = reviewedManifest.reviewedMigrationManifest.map((row, index) => ({
      relativePath: row.relativePath,
      migrationName: row.migrationName,
      checksumSha256: row.checksumSha256,
      executionOrder: sourceAppliedMigrations.length + index + 1,
    }));
    const executedMigrations: ProductionA5ExecutedMigrationSet = {
      status: 'VERIFIED',
      migrations: executedRows,
      migrationsHash: hash(executedRows),
    };
    const hashes = productionA5ManifestHashes(reviewedManifest);
    const sourceAppliedMigrationsHash = hash(sourceAppliedMigrations);
    const sourceSchemaCatalogFingerprint = hash(preSchemaCatalogObjects);
    const resultSchemaCatalogFingerprint = hash(postSchemaCatalogObjects);
    const sourceDatabaseFingerprint = hash({
      sourceAppliedMigrationsHash,
      sourceSchemaCatalogFingerprint,
    });
    const rehearsal = {
      result: 'PASSED' as const,
      engine: 'PostgreSQL' as const,
      engineVersion,
      sourceDatabaseFingerprint,
      sourceAppliedMigrationsHash,
      sourceSchemaCatalogFingerprint,
      resultSchemaCatalogFingerprint,
      reviewedMigrationOperationsHash: hashes.reviewedMigrationOperationsHash,
      expectedSchemaDeltaHash: hashes.expectedSchemaDeltaHash,
      expectedDataTransformHash: hashes.expectedDataTransformHash,
      preconditionResults,
      postSchemaResults,
      postDataResults,
      executedMigrations,
      executionBudgetResults,
      executionBudgetResultsHash: hash(executionBudgetResults),
    };
    const result = {
      schemaVersion: 1,
      sourceAppliedMigrations,
      sourceAppliedMigrationsHash,
      sourceDatabaseFingerprint,
      reviewedManifest,
      ...hashes,
      reimbursementCompatibility,
      cloneRehearsalWithoutCleanup: rehearsal,
    };
    for (const line of chunkCloneResult(result)) process.stdout.write(`${line}\n`);
  } finally {
    await client.$disconnect().catch(() => undefined);
  }
}

if (require.main === module) {
  main().catch(() => {
    console.error('Production A5 clone rehearsal failed: production_a5_clone_rehearsal_failed');
    process.exitCode = 1;
  });
}
