import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  PRODUCTION_A5_REVIEWED_QUERY_CATALOG,
  PRODUCTION_A5_REVIEWED_QUERY_CATALOG_HASH,
  buildProductionA5ReviewedManifestArtifact,
  readProductionA5RepositoryMigrationFiles,
} from '../../prisma/production-a5/reviewed-manifest';
import {
  buildProductionA5CloneRehearsal,
  buildProductionA5PostVerificationEvidence,
  buildProductionA5PreVerificationEvidence,
  runProductionA5ReviewedInvariantPhase,
  type ProductionA5InvariantReadClient,
} from '../../prisma/production-a5/invariant-runner';
import { sha256, stableJson } from './a5-readonly-evidence.logic';
import { productionA5MigrationRiskSummary } from './production-a5-evidence.logic';

function artifact() {
  return buildProductionA5ReviewedManifestArtifact({
    migrationFiles: readProductionA5RepositoryMigrationFiles(),
    preSchemaCatalogObjects: [],
    postSchemaCatalogObjects: [],
  });
}

describe('production A5 reviewed manifest generator', () => {
  it('binds the exact current 42 Git migration bytes and reviewed 18/12/6/6 classes', () => {
    const files = new Map(readProductionA5RepositoryMigrationFiles().map((row) => [row.name, row]));
    const manifest = artifact();
    assert.equal(manifest.reviewedMigrationManifest.length, 42);
    assert.deepEqual(productionA5MigrationRiskSummary(manifest), {
      candidateCount: 42,
      additiveCount: 18,
      backwardCompatibleNonadditiveCount: 12,
      dataBackfillCount: 6,
      blockingContractCount: 6,
      destructiveCustomerDataLossCount: 0,
      manualCustomerInputCount: 0,
      unreviewedCount: 0,
    });
    for (const operation of manifest.reviewedMigrationManifest) {
      const file = files.get(operation.migrationName);
      assert.ok(file);
      assert.equal(operation.checksumSha256, sha256(file.sqlBytes));
      assert.equal(
        operation.executionBudget.lockTimeoutMs,
        operation.migrationName === '20260801150000_drift_forward_fix' ? 5_000 : 2_000,
      );
      assert.equal(operation.executionBudget.statementTimeoutMs, 300_000);
      assert.deepEqual(
        operation.executionBudget,
        {
          lockTimeoutMs: operation.migrationName === '20260801150000_drift_forward_fix' ? 5_000 : 2_000,
          statementTimeoutMs: 300_000,
        },
      );
    }
  });

  it('binds legal acceptance and data-rights tables, enums, constraints, indexes, and exact trigger bodies', () => {
    const manifest = artifact();
    assert.equal(
      manifest.reviewedMigrationManifest.find((row) => (
        row.migrationName === '20260809110000_legal_document_acceptance'
      ))?.operationClass,
      'ADDITIVE',
    );
    assert.equal(
      manifest.reviewedMigrationManifest.find((row) => (
        row.migrationName === '20260809120000_data_rights_case_orchestration'
      ))?.operationClass,
      'ADDITIVE',
    );

    const legalSql = PRODUCTION_A5_REVIEWED_QUERY_CATALOG.find((row) => (
      row.migrationName === '20260809110000_legal_document_acceptance' && row.phase === 'POST_SCHEMA'
    ))?.sql ?? '';
    for (const token of [
      'LegalDocumentActionRecord',
      'LegalDocumentType',
      'LegalAcceptanceCapacity',
      'LegalDocumentActionRecord_scopeRef_documentType_documentVersion_action_key',
      'LegalDocumentActionRecord_prevent_update_delete',
      'LegalDocumentActionRecord_prevent_truncate',
      'b3202b486ba0944610d697033503e7c3',
      'search_path=pg_catalog, public',
    ]) assert.match(legalSql, new RegExp(token));

    const dataRightsSql = PRODUCTION_A5_REVIEWED_QUERY_CATALOG.find((row) => (
      row.migrationName === '20260809120000_data_rights_case_orchestration' && row.phase === 'POST_SCHEMA'
    ))?.sql ?? '';
    for (const token of [
      'DataRightsCase',
      'DataRightsDecisionRecord',
      'DataRightsEvidenceRecord',
      'DataRightsCaseActionRecord',
      'DataRightsCaseStatus',
      'DataRightsDecisionCategory',
      'DataRightsCase_target_shape_check',
      'DataRightsCase_due_after_received_check',
      'DataRightsDecisionRecord_retention_check',
      'DataRightsEvidenceRecord_completion_hash_check',
      'DataRightsCase_active_company_offboarding_target_key',
      'DataRightsCase_transition_guard',
      'DataRightsCase_no_truncate',
      '57a538816992616227edd3d9eb5d5494',
      'ce430d9ae3e3688fadf34db9dcbcb8fb',
      'search_path=pg_catalog, public',
    ]) assert.match(dataRightsSql, new RegExp(token));
  });

  it('is deterministic and the manifest references only the reviewed immutable query catalog', () => {
    const first = artifact();
    const second = artifact();
    assert.equal(stableJson(first), stableJson(second));
    assert.equal(PRODUCTION_A5_REVIEWED_QUERY_CATALOG_HASH, sha256(stableJson(
      PRODUCTION_A5_REVIEWED_QUERY_CATALOG.map(({
        migrationName, phase, id, queryHash, expectedResultHash,
      }) => ({ migrationName, phase, id, queryHash, expectedResultHash })),
    )));

    const refs = first.reviewedMigrationManifest.flatMap((migration) => [
      ...migration.preconditions.map((query) => ({ migrationName: migration.migrationName, phase: 'PRE', ...query })),
      ...migration.postSchemaInvariants.map((query) => ({
        migrationName: migration.migrationName, phase: 'POST_SCHEMA', ...query,
      })),
      ...migration.postDataInvariants.map((query) => ({
        migrationName: migration.migrationName, phase: 'POST_DATA', ...query,
      })),
    ]).sort((left, right) => {
      const a = `${left.migrationName}\0${left.phase}\0${left.id}`;
      const b = `${right.migrationName}\0${right.phase}\0${right.id}`;
      return a < b ? -1 : a > b ? 1 : 0;
    });
    assert.deepEqual(
      refs,
      PRODUCTION_A5_REVIEWED_QUERY_CATALOG.map(({
        migrationName, phase, id, queryHash, expectedResultHash,
      }) => ({ migrationName, phase, id, queryHash, expectedResultHash })),
    );
    for (const query of PRODUCTION_A5_REVIEWED_QUERY_CATALOG) {
      assert.equal(query.queryHash, sha256(query.sql));
      assert.match(query.sql, /^SELECT CASE WHEN \(/);
      assert.doesNotMatch(query.sql, /^SELECT\s+(?:TRUE|1\s*=\s*1)\b/i);
      assert.doesNotMatch(query.sql, /;/);
    }
  });

  it('executes only reviewed SELECT bytes and builds parser-verified PRE/POST evidence', async () => {
    const manifest = artifact();
    const executedSql: string[] = [];
    const client = {
      $queryRawUnsafe: async (sql: string) => {
        executedSql.push(sql);
        return [{ result: 'PASS' }];
      },
    } as unknown as ProductionA5InvariantReadClient;
    const pre = await runProductionA5ReviewedInvariantPhase(client, manifest, 'PRE');
    const postSchema = await runProductionA5ReviewedInvariantPhase(client, manifest, 'POST_SCHEMA');
    const postData = await runProductionA5ReviewedInvariantPhase(client, manifest, 'POST_DATA');
    assert.deepEqual(executedSql, ['PRE', 'POST_SCHEMA', 'POST_DATA'].flatMap((phase) => (
      PRODUCTION_A5_REVIEWED_QUERY_CATALOG.filter((query) => query.phase === phase).map((query) => query.sql)
    )));

    const budgets = manifest.reviewedMigrationManifest.map((operation, index) => ({
      migrationName: operation.migrationName,
      maintenanceWindowId: 'clone-1-a1',
      effectiveLockTimeoutMs: 2_000,
      effectiveStatementTimeoutMs: 300_000,
      lockTimeoutEnforced: true as const,
      statementTimeoutEnforced: true as const,
      lockWaitBelowTimeout: true as const,
      observedStatementDurationMs: 2,
      maintenanceWindowStartedAtEpochMs: 1_000_000 + index * 10,
      maintenanceWindowFinishedAtEpochMs: 1_000_000 + index * 10 + 5,
    }));
    const migrations = manifest.reviewedMigrationManifest.map((operation, index) => ({
      relativePath: operation.relativePath,
      migrationName: operation.migrationName,
      checksumSha256: operation.checksumSha256,
      executionOrder: index + 1,
    }));
    const executedMigrations = {
      status: 'VERIFIED' as const,
      migrations,
      migrationsHash: sha256(stableJson(migrations)),
    };
    const sourceDatabaseFingerprint = 'a'.repeat(64);
    const sourceAppliedMigrationsHash = 'c'.repeat(64);
    const clone = buildProductionA5CloneRehearsal({
      manifest,
      engineVersion: '18.3',
      sourceDatabaseFingerprint,
      sourceAppliedMigrationsHash,
      preconditionResults: pre,
      postSchemaResults: postSchema,
      postDataResults: postData,
      executedMigrations,
      executionBudgetResults: budgets,
      cleanup: {
        status: 'DESTROYED', cloneIdentifierHash: 'b'.repeat(64),
        destroyedAtEpochMs: 2_800_000, residualObjectCount: 0,
      },
    });
    const preEvidence = buildProductionA5PreVerificationEvidence({
      manifest, sourceAppliedMigrationsHash, preconditionResults: pre, cloneRehearsal: clone,
      cloneRehearsalRef: {
        artifactKind: 'PRODUCTION_A5_CLONE_REHEARSAL_V1', producerRunId: '1', producerRunAttempt: 1,
        artifactName: 'clone', contentSha256: 'd'.repeat(64), artifactDigest: `sha256:${'e'.repeat(64)}`,
      },
    });
    const postEvidence = buildProductionA5PostVerificationEvidence({
      manifest,
      sourceAppliedMigrationsHash,
      preMutationVerificationEvidence: preEvidence,
      postSchemaResults: postSchema,
      postDataResults: postData,
      executedMigrations,
      executionBudgetResults: budgets,
    });
    assert.equal(preEvidence.postSchemaResults.status, 'NOT_RUN');
    assert.equal(postEvidence.postSchemaResults.status, 'VERIFIED');

    const forgedManifest = structuredClone(manifest);
    forgedManifest.reviewedMigrationManifest[0]!.preconditions[0]!.queryHash = 'f'.repeat(64);
    await assert.rejects(
      () => runProductionA5ReviewedInvariantPhase(client, forgedManifest, 'PRE'),
      /reviewed_query_catalog_mismatch/,
    );
  });

  it('fails closed on changed migration bytes', () => {
    const files = readProductionA5RepositoryMigrationFiles();
    const tampered = files.map((file, index) => index === files.length - 1
      ? { ...file, sqlBytes: `${file.sqlBytes}\n-- edited` }
      : file);
    assert.throws(() => buildProductionA5ReviewedManifestArtifact({
      migrationFiles: tampered,
      preSchemaCatalogObjects: [],
      postSchemaCatalogObjects: [],
    }), /bytes_mismatch/);
  });
});
