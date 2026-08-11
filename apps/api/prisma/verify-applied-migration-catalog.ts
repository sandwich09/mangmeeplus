/** Fail closed unless this image's complete migration catalog is already applied byte-for-byte. */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { sha256, stableJson } from '../src/scripts/a5-readonly-evidence.logic';
import {
  assertNoProductionA5AwsCredentials,
  readProductionA5AppliedMigrations,
} from '../src/scripts/production-a5-evidence.pg';
import { readProductionA5RepositoryMigrationFiles } from './production-a5/reviewed-manifest';

type MigrationIdentity = { name: string; checksum: string; appliedOrder: number };

function expectedMigrationCatalog(repository: readonly { name: string; fileSha256: string }[]) {
  return repository.map((row, index) => ({
    name: row.name,
    checksum: row.fileSha256,
    appliedOrder: index + 1,
  }));
}

export function exactAppliedMigrationCatalog(input: {
  repository: readonly { name: string; fileSha256: string }[];
  applied: readonly MigrationIdentity[];
  sourceCommit: string;
}) {
  if (!/^[0-9a-f]{40}$/.test(input.sourceCommit)) {
    throw new Error('release_catalog_source_commit_invalid');
  }
  const expected = expectedMigrationCatalog(input.repository);
  if (stableJson(input.applied) !== stableJson(expected)) {
    throw new Error('release_catalog_not_exactly_applied');
  }
  return {
    schemaVersion: 1,
    sourceCommit: input.sourceCommit,
    status: 'EXACT_MATCH' as const,
    migrationCount: expected.length,
    repositoryCatalogHash: sha256(stableJson(expected.map(({ name, checksum }) => ({ name, checksum })))),
    appliedCatalogHash: sha256(stableJson(input.applied)),
  };
}

/** Allow pending append-only migrations while still rejecting any applied-catalog drift. */
export function compatibleAppliedMigrationCatalog(input: {
  repository: readonly { name: string; fileSha256: string }[];
  applied: readonly MigrationIdentity[];
  sourceCommit: string;
}) {
  if (!/^[0-9a-f]{40}$/.test(input.sourceCommit)) {
    throw new Error('release_catalog_source_commit_invalid');
  }
  const expected = expectedMigrationCatalog(input.repository);
  const expectedAppliedPrefix = expected.slice(0, input.applied.length);
  if (input.applied.length > expected.length
    || stableJson(input.applied) !== stableJson(expectedAppliedPrefix)) {
    throw new Error('release_catalog_not_compatible_applied_prefix');
  }
  const pending = expected.slice(input.applied.length);
  return {
    schemaVersion: 1,
    sourceCommit: input.sourceCommit,
    status: pending.length === 0 ? 'EXACT_MATCH' as const : 'APPEND_ONLY_PENDING' as const,
    migrationCount: expected.length,
    appliedMigrationCount: input.applied.length,
    pendingMigrationCount: pending.length,
    repositoryCatalogHash: sha256(stableJson(expected.map(({ name, checksum }) => ({ name, checksum })))),
    appliedCatalogHash: sha256(stableJson(input.applied)),
    pendingCatalogHash: sha256(stableJson(pending.map(({ name, checksum }) => ({ name, checksum })))),
  };
}

async function main(): Promise<void> {
  if (process.env['REQUIRE_NO_AWS_CREDENTIALS'] === 'true') {
    assertNoProductionA5AwsCredentials(process.env);
  }
  const sourceCommit = process.env['GIT_SHA'] ?? '';
  const databaseUrl = process.env['DATABASE_URL'] ?? '';
  const allowPending = process.env['ALLOW_PENDING_MIGRATIONS'] ?? 'false';
  if (allowPending !== 'true' && allowPending !== 'false') {
    throw new Error('release_catalog_allow_pending_invalid');
  }
  if (databaseUrl === '') throw new Error('release_catalog_database_url_required');
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  try {
    const result = await client.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
      await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '2000ms'");
      await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '300000ms'");
      const input = {
        repository: readProductionA5RepositoryMigrationFiles(),
        applied: await readProductionA5AppliedMigrations(tx as unknown as PrismaClient),
        sourceCommit,
      };
      return allowPending === 'true'
        ? compatibleAppliedMigrationCatalog(input)
        : exactAppliedMigrationCatalog(input);
    }, { maxWait: 10_000, timeout: 320_000 });
    const bytes = Buffer.from(`${stableJson(result)}\n`, 'utf8');
    process.stdout.write(`INCIDENT_CATALOG_RESULT 1/1 ${sha256(bytes)} ${bytes.toString('base64')}\n`);
  } finally {
    await client.$disconnect().catch(() => undefined);
  }
}

if (require.main === module) {
  main().catch(() => {
    console.error('Migration catalog verification failed: release_catalog_verification_failed');
    process.exitCode = 1;
  });
}
