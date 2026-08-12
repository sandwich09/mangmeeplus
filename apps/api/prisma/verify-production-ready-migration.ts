/** Re-check the signed READY migration baseline inside the durable Production DB fence. */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { readProductionA5AppliedMigrations } from '../src/scripts/production-a5-evidence.pg';
import { readProductionA5RepositoryMigrationFiles } from './production-a5/reviewed-manifest';
import {
  assertAutomaticPendingMigrationSafety,
  compatibleAppliedMigrationCatalog,
} from './verify-applied-migration-catalog';

function required(name: string): string {
  const value = process.env[name]?.trim() ?? '';
  if (value === '') throw new Error(`production_ready_${name.toLowerCase()}_required`);
  return value;
}

export function assertProductionReadyClassification(input: {
  observed: ReturnType<typeof compatibleAppliedMigrationCatalog>;
  expectedRepositoryHash: string;
  expectedAppliedHash: string;
  expectedPendingHash: string;
  expectedPendingCount: number;
}): void {
  if (input.observed.repositoryCatalogHash !== input.expectedRepositoryHash
    || input.observed.appliedCatalogHash !== input.expectedAppliedHash
    || input.observed.pendingCatalogHash !== input.expectedPendingHash
    || input.observed.pendingMigrationCount !== input.expectedPendingCount
    || (input.expectedPendingCount === 0) !== (input.observed.status === 'EXACT_MATCH')) {
    throw new Error('production_ready_migration_baseline_drift');
  }
}

async function main(): Promise<void> {
  const sourceCommit = required('GIT_SHA');
  const readySha256 = required('PRODUCTION_READY_V2_SHA256');
  const expectedRepositoryHash = required('PRODUCTION_READY_REPOSITORY_CATALOG_HASH');
  const expectedAppliedHash = required('PRODUCTION_READY_APPLIED_CATALOG_HASH');
  const expectedPendingHash = required('PRODUCTION_READY_PENDING_CATALOG_HASH');
  const expectedPendingCount = Number(required('PRODUCTION_READY_PENDING_COUNT'));
  const databaseUrl = required('DATABASE_URL');
  if (!/^[0-9a-f]{40}$/.test(sourceCommit)
    || ![readySha256, expectedRepositoryHash, expectedAppliedHash, expectedPendingHash]
      .every((value) => /^[0-9a-f]{64}$/.test(value))
    || !Number.isSafeInteger(expectedPendingCount) || expectedPendingCount < 0) {
    throw new Error('production_ready_migration_authority_invalid');
  }
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  try {
    const observed = await client.$transaction(async (tx) => {
      const repository = readProductionA5RepositoryMigrationFiles();
      const applied = await readProductionA5AppliedMigrations(tx as unknown as PrismaClient);
      const classification = compatibleAppliedMigrationCatalog({ repository, applied, sourceCommit });
      assertAutomaticPendingMigrationSafety({
        repository,
        applied,
      });
      return classification;
    }, { maxWait: 10_000, timeout: 320_000 });
    assertProductionReadyClassification({
      observed,
      expectedRepositoryHash,
      expectedAppliedHash,
      expectedPendingHash,
      expectedPendingCount,
    });
  } finally {
    await client.$disconnect().catch(() => undefined);
  }
}

if (require.main === module) {
  main().catch(() => {
    console.error('Production READY migration verification failed: production_ready_migration_failed');
    process.exitCode = 1;
  });
}
