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

export function exactAppliedMigrationCatalog(input: {
  repository: readonly { name: string; fileSha256: string }[];
  applied: readonly MigrationIdentity[];
  sourceCommit: string;
}) {
  if (!/^[0-9a-f]{40}$/.test(input.sourceCommit)) {
    throw new Error('release_catalog_source_commit_invalid');
  }
  const expected = input.repository.map((row, index) => ({
    name: row.name,
    checksum: row.fileSha256,
    appliedOrder: index + 1,
  }));
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

async function main(): Promise<void> {
  if (process.env['REQUIRE_NO_AWS_CREDENTIALS'] === 'true') {
    assertNoProductionA5AwsCredentials(process.env);
  }
  const sourceCommit = process.env['GIT_SHA'] ?? '';
  const databaseUrl = process.env['DATABASE_URL'] ?? '';
  if (databaseUrl === '') throw new Error('release_catalog_database_url_required');
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  try {
    const result = await client.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
      await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '2000ms'");
      await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '300000ms'");
      return exactAppliedMigrationCatalog({
        repository: readProductionA5RepositoryMigrationFiles(),
        applied: await readProductionA5AppliedMigrations(tx as unknown as PrismaClient),
        sourceCommit,
      });
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
