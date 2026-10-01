import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  PRODUCTION_A5_EXPECTED_CLOSED_WHT_ROUTES,
  PRODUCTION_A5_EXPECTED_SEEDED_ROUTES,
  PRODUCTION_A5_LEGACY_ABSENT_RELATIONS,
  buildProductionA5Payload,
  parseProductionA5ReviewedManifest,
  parseVerifiedProductionA5Payload,
  productionA5DatabaseFingerprint,
  productionA5ManifestHashes,
  productionA5MigrationRiskSummary,
  productionA5PolicyHashes,
  type ProductionA5BudgetObservation,
  type ProductionA5ChildRef,
  type ProductionA5CloneChildRef,
  type ProductionA5DatabaseSnapshot,
  type ProductionA5InvariantExpectation,
  type ProductionA5InvariantResultSet,
  type ProductionA5MigrationFile,
  type ProductionA5MigrationOperationClass,
  type ProductionA5Payload,
  type ProductionA5ReviewedManifest,
  type ProductionA5ReimbursementWriteQuiesce,
  type ProductionA5SchemaObject,
  type ProductionA5ServingBuild,
  type ProductionA5VerificationEvidence,
} from './production-a5-evidence.logic';
import { sha256, stableJson } from './a5-readonly-evidence.logic';
import { classifyProductionA5ReimbursementApprovalSnapshots, readProductionA5ReimbursementApprovalSnapshots } from './production-a5-evidence.pg';
import { computeSnapshotHash } from '../modules/reimbursements/domain/logic/reimbursement.logic';
import {
  ALL_FEATURE_ENTITLEMENT_KEYS,
  PLATFORM_INVARIANT_FEATURE_KEYS,
  parentFeatureKey,
} from '@watchdog-bms/contracts';

const HASH = (value: string): string => sha256(value);
const CANDIDATE_SHA = 'c'.repeat(40);
const OLD_SHA = 'a'.repeat(40);
const API_IMAGE = `311414082667.dkr.ecr.ap-southeast-1.amazonaws.com/watchdog-bms-api@sha256:${'e'.repeat(64)}`;

function invariant(id: string): ProductionA5InvariantExpectation {
  return { id, queryHash: HASH(`${id}:query`), expectedResultHash: HASH(`${id}:result`) };
}

function sortSchema(rows: ProductionA5SchemaObject[]): ProductionA5SchemaObject[] {
  return rows.sort((left, right) => {
    const a = `${left.kind}\0${left.schema}\0${left.relation ?? ''}\0${left.name}`;
    const b = `${right.kind}\0${right.schema}\0${right.relation ?? ''}\0${right.name}`;
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

function relation(name: string): ProductionA5SchemaObject {
  return { kind: 'RELATION', schema: 'public', relation: name, name, definition: 'r' };
}

function migrationFile(name: string, sqlBytes: string): ProductionA5MigrationFile {
  return { name, fileSha256: HASH(sqlBytes), sqlBytes };
}

function migrationFiles(): ProductionA5MigrationFile[] {
  return [
    migrationFile('20260701000000_existing', 'CREATE TABLE "Existing" ("id" TEXT);'),
    migrationFile('20260801000000_additive', 'CREATE TABLE "Added" ("id" TEXT);'),
    migrationFile('20260801010000_nonadditive', 'ALTER TABLE "Old" DROP CONSTRAINT "Old_fkey";'),
    migrationFile('20260801020000_data_backfill', 'UPDATE "Existing" SET "id" = "id" WHERE "id" IS NOT NULL;'),
    migrationFile('20260801030000_blocking', 'ALTER TABLE "Existing" ALTER COLUMN "id" SET NOT NULL;'),
  ];
}

function operation(
  file: ProductionA5MigrationFile,
  operationClass: ProductionA5MigrationOperationClass,
): Record<string, unknown> {
  return {
    relativePath: `apps/api/prisma/migrations/${file.name}/migration.sql`,
    migrationName: file.name,
    checksumSha256: file.fileSha256,
    operationClass,
    preconditions: [invariant(`${file.name}:PRE`)],
    executionBudget: {
      lockTimeoutMs: 2_000,
      statementTimeoutMs: 300_000,
    },
    postSchemaInvariants: [invariant(`${file.name}:POST_SCHEMA`)],
    postDataInvariants: operationClass === 'DATA_BACKFILL' ? [invariant(`${file.name}:POST_DATA`)] : [],
  };
}

function rawManifest(
  files = migrationFiles(),
  classes: Record<string, ProductionA5MigrationOperationClass> = {
    '20260801000000_additive': 'ADDITIVE',
    '20260801010000_nonadditive': 'BACKWARD_COMPATIBLE_NONADDITIVE',
    '20260801020000_data_backfill': 'DATA_BACKFILL',
    '20260801030000_blocking': 'BLOCKING_CONTRACT',
  },
): Record<string, unknown> {
  const preSchemaCatalogObjects = sortSchema([
    relation('CompanyFeatureEntitlement'),
    {
      kind: 'COLUMN', schema: 'public', relation: 'CompanyFeatureEntitlement', name: 'enabled',
      definition: '{"nullable":true}',
    },
  ]);
  const postSchemaCatalogObjects = sortSchema([
    relation('CompanyFeatureEntitlement'),
    ...PRODUCTION_A5_LEGACY_ABSENT_RELATIONS.map(relation),
    {
      kind: 'COLUMN', schema: 'public', relation: 'CompanyFeatureEntitlement', name: 'enabled',
      definition: '{"nullable":false}',
    },
  ]);
  return {
    schemaVersion: 3,
    catalogScope: {
      version: 1,
      schema: 'public',
      objectKinds: ['COLUMN', 'CONSTRAINT', 'ENUM_VALUE', 'INDEX', 'RELATION'],
    },
    reviewedMigrationManifest: files.filter((file) => classes[file.name])
      .map((file) => operation(file, classes[file.name]!)),
    preSchemaCatalogObjects,
    postSchemaCatalogObjects,
    expectedSeededRoutes: PRODUCTION_A5_EXPECTED_SEEDED_ROUTES,
    expectedClosedWhtRoutes: PRODUCTION_A5_EXPECTED_CLOSED_WHT_ROUTES,
  };
}

function manifest(files = migrationFiles()): ProductionA5ReviewedManifest {
  return parseProductionA5ReviewedManifest(rawManifest(files), files);
}

const readerBoundary: ProductionA5DatabaseSnapshot['readerBoundary'] = {
  role: 'watchdog_a5_prod_ro', defaultReadOnly: true, transactionReadOnly: true,
  noTaskRole: true, nonPrivileged: true, noCreateOrDmlOrMaintain: true,
  noOutsideCoreSelect: true, noExecutableSecurityDefiner: true,
  noOwnershipOrMembership: true, coreRlsVisible: true,
};

function builds(commit = OLD_SHA): ProductionA5ServingBuild[] {
  return [
    { service: 'ai-gateway', sourceCommit: commit },
    { service: 'api-web', sourceCommit: commit },
    { service: 'workers', sourceCommit: commit },
  ];
}

function cloneRef(): ProductionA5CloneChildRef {
  return {
    artifactKind: 'PRODUCTION_A5_CLONE_REHEARSAL_V1', producerRunId: '12222', producerRunAttempt: 1,
    artifactName: 'a5-clone', contentSha256: HASH('clone-content'),
    artifactDigest: `sha256:${HASH('clone-artifact')}`,
  };
}

function reimbursementQuiesce(stage: 'PRE_MUTATION' | 'POST_MIGRATION' | 'POST_DEPLOYMENT'):
ProductionA5ReimbursementWriteQuiesce {
  const bridgeProof = {
    sourceCommit: OLD_SHA,
    image: API_IMAGE,
    serviceRevisionArn: 'arn:aws:ecs:ap-southeast-1:311414082667:service-revision/watchdog-bms-prod/watchdog-bms-api-web-pub/1',
    activeTaskArns: ['arn:aws:ecs:ap-southeast-1:311414082667:task/watchdog-bms-prod/111'],
    quiesceEnabled: true,
    observedAtEpoch: 1_000,
  } as const;
  const common = {
    acceptedFinalSourceCommit: CANDIDATE_SHA,
    acceptedFinalApiImage: API_IMAGE,
    bridgeProof: { ...bridgeProof, activeTaskArns: [...bridgeProof.activeTaskArns] },
    quiesceStartedAtEpoch: 900,
    blockedMutations: { status: 'AVAILABLE' as const, count: 0 },
    allActiveTasksGuarded: true as const,
    allPreBridgeTasksRetired: true as const,
    failurePolicy: 'LEAVE_QUIESCED' as const,
  };
  if (stage !== 'POST_DEPLOYMENT') return {
    status: stage === 'PRE_MUTATION' ? 'BRIDGE_ONLY_QUIESCED' : 'BRIDGE_ONLY_QUIESCED_POST_MIGRATION',
    ...common,
    finalQuiescedProof: null,
    finalUnquiescedProof: null,
    quiesceEndedAtEpoch: null,
    durationSeconds: null,
    reimbursementInvariantHash: stage === 'PRE_MUTATION' ? null : HASH('reimbursement-invariant'),
    allBridgeTasksRetired: null,
    sameFinalImageAcrossUnquiesce: null,
  };
  return {
    status: 'FINAL_ONLY_UNQUIESCED',
    ...common,
    finalQuiescedProof: {
      sourceCommit: CANDIDATE_SHA, image: API_IMAGE,
      serviceRevisionArn: 'arn:aws:ecs:ap-southeast-1:311414082667:service-revision/watchdog-bms-prod/watchdog-bms-api-web-pub/2',
      activeTaskArns: ['arn:aws:ecs:ap-southeast-1:311414082667:task/watchdog-bms-prod/222'],
      quiesceEnabled: true, observedAtEpoch: 1_100,
    },
    finalUnquiescedProof: {
      sourceCommit: CANDIDATE_SHA, image: API_IMAGE,
      serviceRevisionArn: 'arn:aws:ecs:ap-southeast-1:311414082667:service-revision/watchdog-bms-prod/watchdog-bms-api-web-pub/3',
      activeTaskArns: ['arn:aws:ecs:ap-southeast-1:311414082667:task/watchdog-bms-prod/333'],
      quiesceEnabled: false, observedAtEpoch: 1_200,
    },
    quiesceEndedAtEpoch: 1_200,
    durationSeconds: 300,
    reimbursementInvariantHash: HASH('reimbursement-invariant'),
    allBridgeTasksRetired: true,
    sameFinalImageAcrossUnquiesce: true,
  };
}

function preSnapshot(reviewed = manifest()): ProductionA5DatabaseSnapshot {
  const existing = migrationFiles()[0]!;
  return {
    readerBoundary,
    schemaObjects: reviewed.preSchemaCatalogObjects,
    appliedMigrations: [{ name: existing.name, checksum: existing.fileSha256, appliedOrder: 1 }],
    preexistingEntitlementStateHash: HASH('full-entitlement-rows'),
    preexistingAuthorityStateHash: HASH('per-company-effective-authority'),
    reimbursementApprovalSnapshots: {
      total: 2, v2Valid: 0, exactV1Compatible: 2, missingHash: 0, invalid: 0,
      currentStepPending: 2, legacyPartialApproved: 0, legacyPartialRejected: 0, invalidCurrentStep: 0,
    },
    ...productionA5PolicyHashes(),
    launch: null,
    normalization: { status: 'NOT_MATERIALIZED', incomplete: null, drift: null, unexpectedOrigin: null },
  };
}

function postSnapshot(reviewed = manifest()): ProductionA5DatabaseSnapshot {
  const routes = PRODUCTION_A5_EXPECTED_SEEDED_ROUTES.map((row) => ({ ...row, generation: 0 }));
  return {
    ...preSnapshot(reviewed),
    schemaObjects: reviewed.postSchemaCatalogObjects,
    appliedMigrations: migrationFiles().map((file, index) => ({
      name: file.name, checksum: file.fileSha256, appliedOrder: index + 1,
    })),
    launch: { featureLaunchStateHash: HASH(stableJson(routes)), routes },
    normalization: { status: 'MATERIALIZED', incomplete: 0, drift: 0, unexpectedOrigin: 0 },
  };
}

function verifiedResults(
  reviewed: ProductionA5ReviewedManifest,
  key: 'preconditions' | 'postSchemaInvariants' | 'postDataInvariants',
): ProductionA5InvariantResultSet {
  const results = reviewed.reviewedMigrationManifest.flatMap((migration) => migration[key].map((expected) => ({
    migrationName: migration.migrationName,
    ...expected,
    actualResultHash: expected.expectedResultHash,
  })));
  return { status: 'VERIFIED', results, resultsHash: HASH(stableJson(results)) };
}

function budgetResults(reviewed: ProductionA5ReviewedManifest, epochOffset: number): ProductionA5BudgetObservation[] {
  return reviewed.reviewedMigrationManifest.map((migration, index) => ({
    migrationName: migration.migrationName,
    maintenanceWindowId: 'clone-12222-a1',
    effectiveLockTimeoutMs: 2_000,
    effectiveStatementTimeoutMs: 300_000,
    lockTimeoutEnforced: true,
    statementTimeoutEnforced: true,
    lockWaitBelowTimeout: true,
    observedStatementDurationMs: 100,
    maintenanceWindowStartedAtEpochMs: epochOffset + index * 1_000,
    maintenanceWindowFinishedAtEpochMs: epochOffset + index * 1_000 + 500,
  }));
}

function cloneRehearsal(
  reviewed: ProductionA5ReviewedManifest,
  snapshot: ProductionA5DatabaseSnapshot,
  preconditionResults: ProductionA5InvariantResultSet,
  executionBudgetResults: ProductionA5BudgetObservation[],
): ProductionA5VerificationEvidence['cloneRehearsal'] {
  const hashes = productionA5ManifestHashes(reviewed);
  const migrations = reviewed.reviewedMigrationManifest.map((migration, index) => ({
    relativePath: migration.relativePath,
    migrationName: migration.migrationName,
    checksumSha256: migration.checksumSha256,
    executionOrder: index + 2,
  }));
  const facts = {
    result: 'PASSED' as const,
    engine: 'PostgreSQL' as const,
    engineVersion: '18.0',
    sourceDatabaseFingerprint: productionA5DatabaseFingerprint(snapshot),
    sourceAppliedMigrationsHash: HASH(stableJson(snapshot.appliedMigrations)),
    sourceSchemaCatalogFingerprint: HASH(stableJson(reviewed.preSchemaCatalogObjects)),
    resultSchemaCatalogFingerprint: HASH(stableJson(reviewed.postSchemaCatalogObjects)),
    reviewedMigrationOperationsHash: hashes.reviewedMigrationOperationsHash,
    expectedSchemaDeltaHash: hashes.expectedSchemaDeltaHash,
    expectedDataTransformHash: hashes.expectedDataTransformHash,
    preconditionResults,
    postSchemaResults: verifiedResults(reviewed, 'postSchemaInvariants'),
    postDataResults: verifiedResults(reviewed, 'postDataInvariants'),
    executedMigrations: {
      status: 'VERIFIED' as const, migrations, migrationsHash: HASH(stableJson(migrations)),
    },
    executionBudgetResults,
    executionBudgetResultsHash: HASH(stableJson(executionBudgetResults)),
    cleanup: {
      status: 'DESTROYED' as const,
      cloneIdentifierHash: HASH('clone-identifier'),
      destroyedAtEpochMs: 2_600_000,
      residualObjectCount: 0 as const,
    },
  };
  return { ...facts, resultHash: HASH(stableJson(facts)) };
}

function preVerification(
  reviewed: ProductionA5ReviewedManifest,
  snapshot = preSnapshot(reviewed),
): ProductionA5VerificationEvidence {
  const preconditionResults = verifiedResults(reviewed, 'preconditions');
  const executionBudgetResults = budgetResults(reviewed, 1_000_000);
  const executionBudgetResultsHash = HASH(stableJson(executionBudgetResults));
  return {
    cloneRehearsalRef: cloneRef(),
    preconditionResults,
    postSchemaResults: { status: 'NOT_RUN', results: null, resultsHash: null },
    postDataResults: { status: 'NOT_RUN', results: null, resultsHash: null },
    executedMigrations: { status: 'NOT_RUN', migrations: null, migrationsHash: null },
    executionBudgetResults,
    executionBudgetResultsHash,
    cloneRehearsal: cloneRehearsal(
      reviewed, snapshot, preconditionResults, executionBudgetResults,
    ),
  };
}

function postVerification(
  reviewed: ProductionA5ReviewedManifest,
  snapshot: ProductionA5DatabaseSnapshot,
  pre: ProductionA5VerificationEvidence,
): ProductionA5VerificationEvidence {
  const applied = new Map(snapshot.appliedMigrations.map((migration) => [migration.name, migration]));
  const migrations = reviewed.reviewedMigrationManifest.map((migration) => ({
    relativePath: migration.relativePath,
    migrationName: migration.migrationName,
    checksumSha256: migration.checksumSha256,
    executionOrder: applied.get(migration.migrationName)!.appliedOrder,
  }));
  const executionBudgetResults = budgetResults(reviewed, 2_000_000);
  return {
    cloneRehearsalRef: pre.cloneRehearsalRef,
    preconditionResults: pre.preconditionResults,
    postSchemaResults: verifiedResults(reviewed, 'postSchemaInvariants'),
    postDataResults: verifiedResults(reviewed, 'postDataInvariants'),
    executedMigrations: { status: 'VERIFIED', migrations, migrationsHash: HASH(stableJson(migrations)) },
    executionBudgetResults,
    executionBudgetResultsHash: HASH(stableJson(executionBudgetResults)),
    cloneRehearsal: pre.cloneRehearsal,
  };
}

function ref(name: string, attempt = 1): ProductionA5ChildRef {
  return {
    artifactKind: 'PRODUCTION_A5_EVIDENCE_V1', producerRunId: '12345', producerRunAttempt: attempt,
    artifactName: name, contentSha256: HASH(`${name}:content`), artifactDigest: `sha256:${HASH(`${name}:artifact`)}`,
  };
}

function ownerApplyAuthority() {
  return {
    ownerApprovalRef: {
      artifactKind: 'OWNER_U5E_APPROVAL_V1' as const,
      producerRunId: '8001', producerRunAttempt: 1, artifactName: 'owner-u5e-approval',
      contentSha256: HASH('owner-content'), artifactDigest: `sha256:${HASH('owner-artifact')}`,
    },
    maintenanceWindow: {
      windowId: 'u5e-8001-a1-7001-a1', startsAtEpochMs: 1_000, endsAtEpochMs: 2_000,
      failurePolicy: 'LEAVE_REIMBURSEMENT_QUIESCED_REQUIRE_FRESH_APPROVAL' as const,
    },
  };
}

function prePayload(reviewed = manifest(), files = migrationFiles()): ProductionA5Payload {
  const snapshot = preSnapshot(reviewed);
  return buildProductionA5Payload({
    stage: 'PRE_MUTATION', sourceCommit: CANDIDATE_SHA, manifest: reviewed, migrationFiles: files,
    snapshot, verificationEvidence: preVerification(reviewed, snapshot), servingBuilds: builds(),
    reimbursementWriteQuiesce: reimbursementQuiesce('PRE_MUTATION'),
  });
}

function postMigrationPayload(
  reviewed = manifest(),
  pre = prePayload(reviewed),
  files = migrationFiles(),
): ProductionA5Payload {
  const snapshot = postSnapshot(reviewed);
  return buildProductionA5Payload({
    stage: 'POST_MIGRATION', sourceCommit: CANDIDATE_SHA, manifest: reviewed, migrationFiles: files,
    snapshot, verificationEvidence: postVerification(reviewed, snapshot, pre.migrationState.verificationEvidence),
    servingBuilds: builds(), reimbursementWriteQuiesce: reimbursementQuiesce('POST_MIGRATION'),
    preMutationBaseline: { ref: ref('a5-pre'), payloadBytes: stableJson(pre) },
  });
}

const ACTUAL_42_CLASSES: Record<string, ProductionA5MigrationOperationClass> = Object.fromEntries([
  ...[
    '20260712090000_crm_campaign_broadcast', '20260712103000_company_business_policy',
    '20260712130000_employee_profile_email', '20260726120000_crm_booking_deposit_amounts',
    '20260726160000_add_reimbursement_claim_signature', '20260728150000_p1_pdpa_durable_cases',
    '20260728180000_p1_ai_lineage', '20260728200000_user_ai_assistant_opt_out',
    '20260728210000_company_business_category', '20260729120000_ai_usage_ledger',
    '20260729183000_attachment_perceptual_hash', '20260802150000_attempt_fence_hardening',
    '20260803100000_launch_command_results', '20260803150000_normalizer_cohort',
    '20260804100000_wht_certificate_handoff', '20260804120000_feature_launch_observation_bucket',
    '20260809110000_legal_document_acceptance', '20260809120000_data_rights_case_orchestration',
  ].map((name) => [name, 'ADDITIVE']),
  ...[
    '20260712120000_company_retention_consent_policy', '20260728120000_m03_crm_ai_outbound_policy',
    '20260728190000_l01_refresh_token_reuse_detection', '20260728192000_l01_refresh_token_family',
    '20260728210000_add_expense_source_reimbursement', '20260730120000_company_ai_monthly_budget',
    '20260801130000_feature_launch_control_plane_additive', '20260801200000_p0_hardening',
    '20260803110000_normalizer_version', '20260803160000_cohort_kind_check',
    '20260804110000_wht_handoff_link_hardening', '20260804140000_report_view_authority_snapshots',
  ].map((name) => [name, 'BACKWARD_COMPATIBLE_NONADDITIVE']),
  ...[
    '20260726120000_add_reimbursement_line', '20260731120000_ai_fx_and_platform_budget',
    '20260731130000_ai_usage_fx_source', '20260802100000_attempt_identity_lease',
    '20260804130000_remote_release_operation_lease',
    '20260804150000_reimbursement_line_compatibility',
  ].map((name) => [name, 'DATA_BACKFILL']),
  ...[
    '20260728120000_stock_movement_single_reversal', '20260728160000_p1_attachment_link_tenant_fk',
    '20260728170000_p1_branch_tenant_integrity', '20260728191000_l15_tombstone_durability',
    '20260801120000_chart_of_accounts_master_bootstrap', '20260801150000_drift_forward_fix',
  ].map((name) => [name, 'BLOCKING_CONTRACT']),
] as Array<[string, ProductionA5MigrationOperationClass]>);

function actual42Files(): ProductionA5MigrationFile[] {
  return Object.keys(ACTUAL_42_CLASSES).sort().map((name) => {
    const sqlBytes = readFileSync(join(__dirname, '../../prisma/migrations', name, 'migration.sql'), 'utf8');
    return migrationFile(name, sqlBytes);
  });
}

describe('production A5 H2 evidence contract', () => {
  it('derives exact reviewed risk/hash catalogs and parses all 42 audited migration bytes', () => {
    const files = actual42Files();
    const reviewed = parseProductionA5ReviewedManifest(rawManifest(files, ACTUAL_42_CLASSES), files);
    assert.equal(reviewed.reviewedMigrationManifest.length, 42);
    assert.deepEqual(productionA5MigrationRiskSummary(reviewed), {
      candidateCount: 42, additiveCount: 18, backwardCompatibleNonadditiveCount: 12,
      dataBackfillCount: 6, blockingContractCount: 6, destructiveCustomerDataLossCount: 0,
      manualCustomerInputCount: 0, unreviewedCount: 0,
    });
  });

  it('does not mistake FK/append-only trigger events for DML, but still rejects real mutations', () => {
    const files = actual42Files();
    parseProductionA5ReviewedManifest(rawManifest(files, ACTUAL_42_CLASSES), files);
    const targetIndex = files.findIndex((file) => file.name === '20260712090000_crm_campaign_broadcast');
    const target = files[targetIndex]!;
    const seeded = migrationFile(target.name, `${target.sqlBytes}\nINSERT INTO "Seed" ("id") VALUES ('x');\n`);
    const changed = [...files];
    changed[targetIndex] = seeded;
    assert.throws(
      () => parseProductionA5ReviewedManifest(rawManifest(changed, ACTUAL_42_CLASSES), changed),
      /data_mutation_class_mismatch/,
    );

    const legalIndex = files.findIndex((file) => file.name === '20260809110000_legal_document_acceptance');
    const legal = files[legalIndex]!;
    const truncated = migrationFile(
      legal.name,
      `${legal.sqlBytes}\nTRUNCATE TABLE "LegalDocumentActionRecord";\n`,
    );
    const destructive = [...files];
    destructive[legalIndex] = truncated;
    assert.throws(
      () => parseProductionA5ReviewedManifest(rawManifest(destructive, ACTUAL_42_CLASSES), destructive),
      /destructive_data_loss_operation/,
    );

    for (const statement of [
      `DO $$ BEGIN EXECUTE 'TRUNCATE TABLE "Customer"'; END $$;`,
      `DO $$ BEGIN EXECUTE 'DELETE FROM "Customer"'; END $$;`,
    ]) {
      const dynamicDestructive = [...files];
      dynamicDestructive[legalIndex] = migrationFile(legal.name, `${legal.sqlBytes}\n${statement}\n`);
      assert.throws(
        () => parseProductionA5ReviewedManifest(
          rawManifest(dynamicDestructive, ACTUAL_42_CLASSES), dynamicDestructive,
        ),
        /destructive_data_loss_operation/,
      );
    }

    const dynamicInsert = [...files];
    dynamicInsert[legalIndex] = migrationFile(
      legal.name,
      `${legal.sqlBytes}\nDO $$ BEGIN EXECUTE 'INSERT INTO "Customer" ("id") VALUES (1)'; END $$;\n`,
    );
    assert.throws(
      () => parseProductionA5ReviewedManifest(rawManifest(dynamicInsert, ACTUAL_42_CLASSES), dynamicInsert),
      /data_mutation_class_mismatch/,
    );
  });

  it('binds exact expected/actual invariant results, execution order, budgets and clone rehearsal', () => {
    const reviewed = manifest();
    const pre = prePayload(reviewed);
    assert.equal(pre.migrationState.verificationEvidence.postSchemaResults.status, 'NOT_RUN');
    assert.equal(parseVerifiedProductionA5Payload(stableJson(pre)).stage, 'PRE_MUTATION');

    const postMigration = postMigrationPayload(reviewed, pre);
    assert.equal(postMigration.comparisons.exactReviewedMigrationSetApplied, true);
    assert.equal(postMigration.comparisons.exactExpectedSchemaDeltaMaterialized, true);
    assert.equal(postMigration.comparisons.exactExpectedDataTransformsVerified, true);
    assert.equal(postMigration.comparisons.allPreflightConditionsSatisfied, true);
    assert.equal(postMigration.comparisons.lockBudgetSatisfied, true);

    const snapshot = postSnapshot(reviewed);
    const postDeployment = buildProductionA5Payload({
      stage: 'POST_DEPLOYMENT', sourceCommit: CANDIDATE_SHA, manifest: reviewed,
      migrationFiles: migrationFiles(), snapshot,
      verificationEvidence: postMigration.migrationState.verificationEvidence,
      servingBuilds: builds(CANDIDATE_SHA),
      reimbursementWriteQuiesce: reimbursementQuiesce('POST_DEPLOYMENT'),
      preMutationBaseline: { ref: ref('a5-pre'), payloadBytes: stableJson(pre) },
      postMigrationBaseline: { ref: ref('a5-post-migration', 2), payloadBytes: stableJson(postMigration) },
    });
    assert.ok(Object.values(postDeployment.comparisons).every((value) => value === true));
  });

  it('accepts only the controller-completed reader/current-health and apply-authority pair', () => {
    const corePre = prePayload();
    const completedPre = structuredClone(corePre);
    completedPre.currentHealth = { status: 'PASS' };
    completedPre.readerRuntime = { schemaVersion: 1 };
    completedPre.migrationState.productionApplyAuthority = null;
    assert.equal(parseVerifiedProductionA5Payload(stableJson(completedPre)).stage, 'PRE_MUTATION');

    const corePost = postMigrationPayload();
    const completedPost = structuredClone(corePost);
    completedPost.currentHealth = { status: 'PASS' };
    completedPost.readerRuntime = { schemaVersion: 1 };
    completedPost.migrationState.productionApplyAuthority = ownerApplyAuthority();
    assert.equal(parseVerifiedProductionA5Payload(stableJson(completedPost)).stage, 'POST_MIGRATION');

    const incomplete = structuredClone(corePre);
    incomplete.currentHealth = { status: 'PASS' };
    assert.throws(() => parseVerifiedProductionA5Payload(stableJson(incomplete)), /controller_fields_incomplete/);
    completedPost.migrationState.productionApplyAuthority = null;
    assert.throws(() => parseVerifiedProductionA5Payload(stableJson(completedPost)), /production_apply_authority_invalid/);
  });

  it('rejects forged actual results, over-budget observations and clone result hashes', () => {
    const reviewed = manifest();
    const snapshot = preSnapshot(reviewed);
    const actualTamper = structuredClone(preVerification(reviewed, snapshot));
    if (actualTamper.preconditionResults.status === 'VERIFIED') {
      actualTamper.preconditionResults.results[0]!.actualResultHash = HASH('forged');
      actualTamper.preconditionResults.resultsHash = HASH(stableJson(actualTamper.preconditionResults.results));
    }
    assert.throws(() => buildProductionA5Payload({
      stage: 'PRE_MUTATION', sourceCommit: CANDIDATE_SHA, manifest: reviewed,
      migrationFiles: migrationFiles(), snapshot, verificationEvidence: actualTamper, servingBuilds: builds(),
      reimbursementWriteQuiesce: reimbursementQuiesce('PRE_MUTATION'),
    }), /actual_result_mismatch/);

    const overBudget = structuredClone(preVerification(reviewed, snapshot));
    overBudget.executionBudgetResults[0]!.observedStatementDurationMs = 300_001;
    overBudget.executionBudgetResultsHash = HASH(stableJson(overBudget.executionBudgetResults));
    overBudget.cloneRehearsal.executionBudgetResultsHash = overBudget.executionBudgetResultsHash;
    const { resultHash: _old, ...cloneFacts } = overBudget.cloneRehearsal;
    overBudget.cloneRehearsal.resultHash = HASH(stableJson(cloneFacts));
    assert.throws(() => buildProductionA5Payload({
      stage: 'PRE_MUTATION', sourceCommit: CANDIDATE_SHA, manifest: reviewed,
      migrationFiles: migrationFiles(), snapshot, verificationEvidence: overBudget, servingBuilds: builds(),
      reimbursementWriteQuiesce: reimbursementQuiesce('PRE_MUTATION'),
    }), /execution_budget_not_satisfied/);

    const badClone = structuredClone(preVerification(reviewed, snapshot));
    badClone.cloneRehearsal.resultHash = HASH('forged-clone');
    assert.throws(() => buildProductionA5Payload({
      stage: 'PRE_MUTATION', sourceCommit: CANDIDATE_SHA, manifest: reviewed,
      migrationFiles: migrationFiles(), snapshot, verificationEvidence: badClone, servingBuilds: builds(),
      reimbursementWriteQuiesce: reimbursementQuiesce('PRE_MUTATION'),
    }), /clone_rehearsal_hash_mismatch/);

    const selfConsistentForgery = structuredClone(preVerification(reviewed, snapshot));
    const clonePostSchema = selfConsistentForgery.cloneRehearsal.postSchemaResults;
    assert.equal(clonePostSchema.status, 'VERIFIED');
    if (clonePostSchema.status === 'VERIFIED') {
      clonePostSchema.results[0]!.actualResultHash = HASH('forged-but-rehashed');
      clonePostSchema.resultsHash = HASH(stableJson(clonePostSchema.results));
    }
    const { resultHash: _forgedOld, ...forgedFacts } = selfConsistentForgery.cloneRehearsal;
    selfConsistentForgery.cloneRehearsal.resultHash = HASH(stableJson(forgedFacts));
    assert.throws(() => buildProductionA5Payload({
      stage: 'PRE_MUTATION', sourceCommit: CANDIDATE_SHA, manifest: reviewed,
      migrationFiles: migrationFiles(), snapshot,
      verificationEvidence: selfConsistentForgery, servingBuilds: builds(),
      reimbursementWriteQuiesce: reimbursementQuiesce('PRE_MUTATION'),
    }), /clone_post_schema_results_actual_result_mismatch/);

    const omittedCloneResult = structuredClone(preVerification(reviewed, snapshot));
    const omittedPostSchema = omittedCloneResult.cloneRehearsal.postSchemaResults;
    assert.equal(omittedPostSchema.status, 'VERIFIED');
    if (omittedPostSchema.status === 'VERIFIED') {
      omittedPostSchema.results.pop();
      omittedPostSchema.resultsHash = HASH(stableJson(omittedPostSchema.results));
    }
    const { resultHash: _omittedOld, ...omittedFacts } = omittedCloneResult.cloneRehearsal;
    omittedCloneResult.cloneRehearsal.resultHash = HASH(stableJson(omittedFacts));
    assert.throws(() => buildProductionA5Payload({
      stage: 'PRE_MUTATION', sourceCommit: CANDIDATE_SHA, manifest: reviewed,
      migrationFiles: migrationFiles(), snapshot,
      verificationEvidence: omittedCloneResult, servingBuilds: builds(),
      reimbursementWriteQuiesce: reimbursementQuiesce('PRE_MUTATION'),
    }), /clone_post_schema_results_actual_result_mismatch/);
  });

  it('rejects zero/unbounded budgets and missing per-migration invariant catalogs', () => {
    const files = migrationFiles();
    const zeroBudget = rawManifest(files);
    const zeroOperation = (zeroBudget['reviewedMigrationManifest'] as Array<Record<string, unknown>>)[0]!;
    (zeroOperation['executionBudget'] as Record<string, unknown>)['lockTimeoutMs'] = 0;
    assert.throws(() => parseProductionA5ReviewedManifest(zeroBudget, files), /lock_timeout_invalid/);

    const excessiveBudget = rawManifest(files);
    const excessiveOperation = (excessiveBudget['reviewedMigrationManifest'] as Array<Record<string, unknown>>)[0]!;
    (excessiveOperation['executionBudget'] as Record<string, unknown>)['statementTimeoutMs'] = 900_001;
    assert.throws(() => parseProductionA5ReviewedManifest(excessiveBudget, files), /statement_timeout_exceeds_bound/);

    const missingPost = rawManifest(files);
    (missingPost['reviewedMigrationManifest'] as Array<Record<string, unknown>>)[0]!['postSchemaInvariants'] = [];
    assert.throws(() => parseProductionA5ReviewedManifest(missingPost, files), /invariant_catalog_incomplete/);
  });

  it('rejects unknown/missing/edited/orphan/unexpectedly-applied migration state', () => {
    const reviewed = manifest();
    const extra = migrationFile('20260801040000_unknown', 'CREATE TABLE "Unknown" ("id" TEXT);');
    assert.throws(() => prePayload(reviewed, [...migrationFiles(), extra]), /live_pending_set_not_exactly_reviewed/);

    const missing = rawManifest();
    (missing['reviewedMigrationManifest'] as unknown[]).pop();
    const incompleteReview = parseProductionA5ReviewedManifest(missing, migrationFiles());
    assert.throws(() => prePayload(incompleteReview), /live_pending_set_not_exactly_reviewed/);

    const edited = preSnapshot(reviewed);
    edited.appliedMigrations[0] = { ...edited.appliedMigrations[0]!, checksum: HASH('edited') };
    assert.throws(() => buildProductionA5Payload({
      stage: 'PRE_MUTATION', sourceCommit: CANDIDATE_SHA, manifest: reviewed,
      migrationFiles: migrationFiles(), snapshot: edited,
      verificationEvidence: preVerification(reviewed, edited), servingBuilds: builds(),
      reimbursementWriteQuiesce: reimbursementQuiesce('PRE_MUTATION'),
    }), /edited_applied_migration/);

    const orphan = preSnapshot(reviewed);
    orphan.appliedMigrations.push({ name: '20260702000000_orphan', checksum: HASH('orphan'), appliedOrder: 2 });
    assert.throws(() => buildProductionA5Payload({
      stage: 'PRE_MUTATION', sourceCommit: CANDIDATE_SHA, manifest: reviewed,
      migrationFiles: migrationFiles(), snapshot: orphan,
      verificationEvidence: preVerification(reviewed, orphan), servingBuilds: builds(),
      reimbursementWriteQuiesce: reimbursementQuiesce('PRE_MUTATION'),
    }), /orphan_applied_migration/);

    const unexpectedlyApplied = preSnapshot(reviewed);
    const candidate = migrationFiles()[1]!;
    unexpectedlyApplied.appliedMigrations.push({
      name: candidate.name, checksum: candidate.fileSha256, appliedOrder: 2,
    });
    assert.throws(() => buildProductionA5Payload({
      stage: 'PRE_MUTATION', sourceCommit: CANDIDATE_SHA, manifest: reviewed,
      migrationFiles: migrationFiles(), snapshot: unexpectedlyApplied,
      verificationEvidence: preVerification(reviewed, unexpectedlyApplied), servingBuilds: builds(),
      reimbursementWriteQuiesce: reimbursementQuiesce('PRE_MUTATION'),
    }), /live_pending_set_not_exactly_reviewed/);
  });

  it('rejects executed migration order/checksum evidence that disagrees with the database', () => {
    const reviewed = manifest();
    const pre = prePayload(reviewed);
    const snapshot = postSnapshot(reviewed);
    const evidence = postVerification(reviewed, snapshot, pre.migrationState.verificationEvidence);
    if (evidence.executedMigrations.status === 'VERIFIED') {
      evidence.executedMigrations.migrations[1]!.executionOrder = 99;
      evidence.executedMigrations.migrationsHash = HASH(stableJson(evidence.executedMigrations.migrations));
    }
    assert.throws(() => buildProductionA5Payload({
      stage: 'POST_MIGRATION', sourceCommit: CANDIDATE_SHA, manifest: reviewed,
      migrationFiles: migrationFiles(), snapshot, verificationEvidence: evidence, servingBuilds: builds(),
      reimbursementWriteQuiesce: reimbursementQuiesce('POST_MIGRATION'),
      preMutationBaseline: { ref: ref('a5-pre'), payloadBytes: stableJson(pre) },
    }), /set_or_order_mismatch|database_evidence_mismatch/);
  });

  it('rejects forged passed baselines, unknown fields and schema/authority drift', () => {
    const reviewed = manifest();
    const pre = prePayload(reviewed);
    const forged = structuredClone(pre);
    forged.comparisons.allPreflightConditionsSatisfied = true;
    assert.throws(() => parseVerifiedProductionA5Payload(stableJson(forged)), /pre_invariant_failed/);

    const withExtra = structuredClone(pre) as ProductionA5Payload & {
      migrationState: ProductionA5Payload['migrationState'] & { operatorSaysPassed?: boolean };
    };
    withExtra.migrationState.operatorSaysPassed = true;
    assert.throws(() => parseVerifiedProductionA5Payload(stableJson(withExtra)), /migration_state_fields_invalid/);

    const missingHash = structuredClone(pre);
    missingHash.reimbursementApprovalSnapshots = {
      total: 2, v2Valid: 0, exactV1Compatible: 1, missingHash: 1, invalid: 0,
      currentStepPending: 2, legacyPartialApproved: 0, legacyPartialRejected: 0, invalidCurrentStep: 0,
    };
    assert.throws(
      () => parseVerifiedProductionA5Payload(stableJson(missingHash)),
      /reimbursement_approval_snapshots_not_clean/,
    );

    const selfConsistentInvalid = structuredClone(pre);
    selfConsistentInvalid.reimbursementApprovalSnapshots = {
      total: 2, v2Valid: 0, exactV1Compatible: 1, missingHash: 0, invalid: 1,
      currentStepPending: 2, legacyPartialApproved: 0, legacyPartialRejected: 0, invalidCurrentStep: 0,
    };
    selfConsistentInvalid.databaseFingerprint = productionA5DatabaseFingerprint({
      ...preSnapshot(reviewed),
      reimbursementApprovalSnapshots: selfConsistentInvalid.reimbursementApprovalSnapshots,
    });
    assert.throws(
      () => parseVerifiedProductionA5Payload(stableJson(selfConsistentInvalid)),
      /reimbursement_approval_snapshots_not_clean/,
    );

    for (const field of ['legacyPartialApproved', 'legacyPartialRejected', 'invalidCurrentStep'] as const) {
      const partial = structuredClone(pre);
      partial.reimbursementApprovalSnapshots.currentStepPending = 1;
      partial.reimbursementApprovalSnapshots[field] = 1;
      assert.throws(
        () => parseVerifiedProductionA5Payload(stableJson(partial)),
        /reimbursement_approval_steps_not_clean/,
      );
    }

    const wrongTotal = structuredClone(pre);
    wrongTotal.reimbursementApprovalSnapshots.total = 3;
    assert.throws(
      () => parseVerifiedProductionA5Payload(stableJson(wrongTotal)),
      /reimbursement_approval_snapshots_total_mismatch/,
    );

    const authorityDrift = postSnapshot(reviewed);
    authorityDrift.preexistingEntitlementStateHash = HASH('same-count-different-full-rows');
    assert.throws(() => buildProductionA5Payload({
      stage: 'POST_MIGRATION', sourceCommit: CANDIDATE_SHA, manifest: reviewed,
      migrationFiles: migrationFiles(), snapshot: authorityDrift,
      verificationEvidence: postVerification(reviewed, authorityDrift, pre.migrationState.verificationEvidence),
      servingBuilds: builds(),
      reimbursementWriteQuiesce: reimbursementQuiesce('POST_MIGRATION'),
      preMutationBaseline: { ref: ref('a5-pre'), payloadBytes: stableJson(pre) },
    }), /preexisting_authority_drift/);
  });

  it('requires the exact explicit schema scope and code-owned seed catalog', () => {
    const reviewed = manifest();
    const snapshot = preSnapshot(reviewed);
    assert.throws(() => buildProductionA5Payload({
      stage: 'PRE_MUTATION', sourceCommit: CANDIDATE_SHA, manifest: reviewed,
      migrationFiles: migrationFiles(), snapshot: {
        ...snapshot, schemaObjects: [...reviewed.preSchemaCatalogObjects, relation('Unexpected')],
      }, verificationEvidence: preVerification(reviewed, snapshot), servingBuilds: builds(),
      reimbursementWriteQuiesce: reimbursementQuiesce('PRE_MUTATION'),
    }), /reviewed_schema_mismatch/);

    const badSeed = rawManifest();
    badSeed['expectedSeededRoutes'] = PRODUCTION_A5_EXPECTED_SEEDED_ROUTES.slice(1);
    assert.throws(() => parseProductionA5ReviewedManifest(badSeed, migrationFiles()), /seed_catalog_mismatch/);
  });

  /**
   * A platform SUBMENU is not a commercial toggle either — `company_settings.security` carries the
   * password/identity grants and `employee_access.employees` the employee-management ones, and
   * `set-partner-features.use-case.ts:143` refuses to write an explicit `false` for them. The
   * admission projection must resolve the parent the same way, or the published allowlist claims a
   * key is clear-to-off that the command will never accept. Re-add the naive
   * `includes(featureKey)` and this fails.
   */
  it('resolves a submenu to its parent before the freeze-in-place platform-invariant check', () => {
    const platformSubmenus = ALL_FEATURE_ENTITLEMENT_KEYS
      .filter((key) => key.includes('.') && PLATFORM_INVARIANT_FEATURE_KEYS.includes(parentFeatureKey(key)));
    assert.ok(platformSubmenus.length > 0, 'the catalog must still carry platform submenus to guard');

    const expectedAllowList = [...ALL_FEATURE_ENTITLEMENT_KEYS].sort()
      .filter((key) => !PLATFORM_INVARIANT_FEATURE_KEYS.includes(parentFeatureKey(key)));
    for (const key of platformSubmenus) assert.equal(expectedAllowList.includes(key), false, key);
    assert.equal(productionA5PolicyHashes().allowListHash, sha256(stableJson(expectedAllowList)));
  });
});

// The payout-account release adds a payout part to the hash of every claim sent with a receiving
// method. The production gate must hash those claims the way the live approval check does, or the
// first pending claim sent after the release would be counted as a corrupted snapshot.
describe('production A5 pending claims sent with a receiving method', () => {
  const incurredDate = new Date('2026-10-01T00:00:00.000Z');
  const header = {
    requestId: 'claim-1', companyId: 'tenant-secret', title: 'private title', reason: 'private reason',
    categoryKey: 'travel', categoryLabelSnapshot: null, amount: '100.0000', currency: 'THB', incurredDate,
    primaryAttachmentId: null, linkedExpenseId: null,
    currentApprovalStepId: 'step-1', currentStepStatus: 'PENDING', currentStepDecidedAt: null,
    currentStepDecisionByUserId: null, currentStepComment: null, currentStepRejectionReason: null,
  };
  const line = {
    id: 'line-1', companyId: 'tenant-secret', reimbursementRequestId: 'claim-1', lineNo: 1, incurredDate,
    description: 'แท็กซี่', purpose: null, categoryKey: 'travel', categoryLabelSnapshot: null, amount: '100.0000',
    attachmentId: null, linkedExpenseId: null,
  };
  const hashOf = (payout: Record<string, unknown>) => computeSnapshotHash({
    amount: header.amount, currency: header.currency, categoryKey: header.categoryKey, incurredDate: incurredDate.toISOString(),
    reason: header.reason, title: header.title, lines: [{ ...line, incurredDate: incurredDate.toISOString() }], ...payout,
  } as any);
  const classify = (stored: string, columns: Record<string, unknown>) =>
    classifyProductionA5ReimbursementApprovalSnapshots('POST_MIGRATION', [{ ...header, approvalSnapshotHash: stored, ...columns }], [line]);

  it('classifies a transfer claim, a cash claim and a legacy claim as valid, each by its own columns', () => {
    const transfer = { payoutMethod: 'BANK_TRANSFER', payoutDestinationVersion: 1, payoutFingerprint: 'fingerprint-secret' };
    const cash = { payoutMethod: 'CASH', payoutDestinationVersion: null, payoutFingerprint: 'cash' };
    const legacy = { payoutMethod: null, payoutDestinationVersion: null, payoutFingerprint: null };
    for (const columns of [transfer, cash, legacy]) {
      const result = classify(hashOf(columns), columns);
      assert.deepEqual([result.v2Valid, result.invalid], [1, 0], JSON.stringify(columns));
      assert.equal(JSON.stringify(result).includes('fingerprint-secret'), false);
    }
    // Three different hashes: the payout part is really in the hash, and a legacy claim keeps the old one.
    assert.equal(new Set([hashOf(transfer), hashOf(cash), hashOf(legacy)]).size, 3);
    assert.equal(hashOf(legacy), hashOf({}));
    // A snapshot that moved after the claim was sent is what this gate exists to catch.
    assert.equal(classify(hashOf(transfer), { ...transfer, payoutDestinationVersion: 2 }).invalid, 1);
    assert.equal(classify(hashOf(transfer), { ...transfer, payoutFingerprint: 'another-account' }).invalid, 1);
    assert.equal(classify(hashOf(transfer), legacy).invalid, 1);
    // A draft's choice that an older build sent without a snapshot (no fingerprint) is a legacy claim here too.
    const leftByADraft = { payoutMethod: 'BANK_TRANSFER', payoutDestinationVersion: 1, payoutFingerprint: null };
    assert.equal(hashOf(leftByADraft), hashOf(legacy));
    assert.equal(classify(hashOf(legacy), leftByADraft).v2Valid, 1);
  });

  it('reads the payout columns in a way a database from before the migration can still answer', async () => {
    const queries: string[] = [];
    await readProductionA5ReimbursementApprovalSnapshots({
      $queryRawUnsafe: (async (sql: string) => { queries.push(sql); return []; }) as any,
    }, 'POST_MIGRATION');
    for (const column of ['payoutMethod', 'payoutDestinationVersion', 'payoutFingerprint']) {
      assert.ok(queries.some((sql) => sql.includes(`to_jsonb(request)->>'${column}'`)), column);
      assert.ok(queries.every((sql) => !sql.includes(`request."${column}"`)), column);
    }
  });
});
