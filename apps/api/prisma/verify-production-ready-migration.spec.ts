import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assertProductionReadyClassification } from './verify-production-ready-migration';
import { assertAutomaticPendingMigrationSafety } from './verify-applied-migration-catalog';

const hash = (character: string) => character.repeat(64);
const observed = {
  schemaVersion: 1 as const,
  sourceCommit: 'a'.repeat(40),
  status: 'APPEND_ONLY_PENDING' as const,
  migrationCount: 3,
  appliedMigrationCount: 2,
  pendingMigrationCount: 1,
  repositoryCatalogHash: hash('1'),
  appliedCatalogHash: hash('2'),
  pendingCatalogHash: hash('3'),
};

describe('Production READY migration authority', () => {
  it('accepts the exact readiness classification', () => {
    assert.doesNotThrow(() => assertProductionReadyClassification({
      observed,
      expectedRepositoryHash: hash('1'),
      expectedAppliedHash: hash('2'),
      expectedPendingHash: hash('3'),
      expectedPendingCount: 1,
    }));
  });

  it('rejects any ledger or pending-set drift', () => {
    assert.throws(() => assertProductionReadyClassification({
      observed,
      expectedRepositoryHash: hash('1'),
      expectedAppliedHash: hash('9'),
      expectedPendingHash: hash('3'),
      expectedPendingCount: 1,
    }), /production_ready_migration_baseline_drift/);
  });

  it('allows non-destructive pending SQL and ignores already-applied historical SQL', () => {
    assert.doesNotThrow(() => assertAutomaticPendingMigrationSafety({
      repository: [
        { name: 'applied', fileSha256: hash('1'), sqlBytes: 'DROP TABLE historical;' },
        { name: 'pending', fileSha256: hash('2'), sqlBytes: 'ALTER TABLE "Company" ADD COLUMN "code" TEXT;' },
      ],
      appliedMigrationCount: 1,
    }));
  });

  it('rejects destructive pending SQL before Production mutation', () => {
    assert.throws(() => assertAutomaticPendingMigrationSafety({
      repository: [
        { name: 'pending', fileSha256: hash('1'), sqlBytes: 'DROP COLUMN "taxId";' },
      ],
      appliedMigrationCount: 0,
    }), /production_a5_destructive_data_loss_operation/);
    assert.throws(() => assertAutomaticPendingMigrationSafety({
      repository: [
        { name: 'pending', fileSha256: hash('1'), sqlBytes: "DO $$ BEGIN EXECUTE 'TRUNCATE TABLE receipts'; END $$;" },
      ],
      appliedMigrationCount: 0,
    }), /production_a5_destructive_data_loss_operation/);
  });
});
