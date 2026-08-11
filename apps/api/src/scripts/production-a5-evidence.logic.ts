import {
  ALL_FEATURE_ENTITLEMENT_KEYS,
  PLATFORM_INVARIANT_FEATURE_KEYS,
  parentFeatureKey,
} from '@watchdog-bms/contracts';
import {
  MATERIALIZABLE_LAUNCH_MATRIX_ROWS,
} from '../modules/feature-launch/domain/launch-matrix.catalog';
import { sha256, stableJson } from './a5-readonly-evidence.logic';

export const PRODUCTION_A5_STAGES = ['PRE_MUTATION', 'POST_MIGRATION', 'POST_DEPLOYMENT'] as const;
export type ProductionA5Stage = (typeof PRODUCTION_A5_STAGES)[number];

export const PRODUCTION_A5_LEGACY_PRESENT_RELATIONS = ['CompanyFeatureEntitlement'] as const;
export const PRODUCTION_A5_LEGACY_ABSENT_RELATIONS = [
  'CompanyEntitlementNormalization',
  'EntitlementTransition',
  'ExecutionAttempt',
  'FeatureLaunchGate',
  'FeatureLaunchGateTransition',
  'FeatureLaunchObservationBucket',
  'RunoffSnapshot',
] as const;
export const PRODUCTION_A5_SCHEMA_SCOPE = [
  ...PRODUCTION_A5_LEGACY_PRESENT_RELATIONS,
  ...PRODUCTION_A5_LEGACY_ABSENT_RELATIONS,
].sort();

export type ProductionA5Route = {
  gateKey: string;
  routeKey: string;
  state: 'OPEN' | 'CLOSED';
};

export const PRODUCTION_A5_EXPECTED_SEEDED_ROUTES: readonly ProductionA5Route[] =
  MATERIALIZABLE_LAUNCH_MATRIX_ROWS
    .map((row) => ({ gateKey: row.gateKey, routeKey: row.routeKey, state: row.seedState }))
    .sort(compareRoute);

export const PRODUCTION_A5_EXPECTED_CLOSED_WHT_ROUTES: readonly ProductionA5Route[] =
  PRODUCTION_A5_EXPECTED_SEEDED_ROUTES.filter((row) => row.gateKey === 'cap.wht50bis');

export type ProductionA5SchemaObject = {
  kind: 'RELATION' | 'COLUMN' | 'INDEX' | 'CONSTRAINT' | 'ENUM_VALUE';
  schema: string;
  relation: string | null;
  name: string;
  definition: string;
};

export type ProductionA5MigrationIdentity = { name: string; checksum: string; appliedOrder: number };

export const PRODUCTION_A5_MIGRATION_OPERATION_CLASSES = [
  'ADDITIVE',
  'BACKWARD_COMPATIBLE_NONADDITIVE',
  'DATA_BACKFILL',
  'BLOCKING_CONTRACT',
] as const;
export type ProductionA5MigrationOperationClass =
  (typeof PRODUCTION_A5_MIGRATION_OPERATION_CLASSES)[number];

export type ProductionA5MigrationFile = {
  name: string;
  fileSha256: string;
  sqlBytes: string;
};

export type ProductionA5InvariantExpectation = {
  id: string;
  queryHash: string;
  expectedResultHash: string;
};

export type ProductionA5ExecutionBudget = {
  lockTimeoutMs: number;
  statementTimeoutMs: number;
};

export const PRODUCTION_A5_MAX_LOCK_TIMEOUT_MS = 5_000;
export const PRODUCTION_A5_MAX_STATEMENT_TIMEOUT_MS = 5 * 60_000;
export const PRODUCTION_A5_MAX_MAINTENANCE_WINDOW_MS = 30 * 60_000;

export type ProductionA5ReviewedMigrationOperation = {
  relativePath: string;
  migrationName: string;
  checksumSha256: string;
  operationClass: ProductionA5MigrationOperationClass;
  preconditions: ProductionA5InvariantExpectation[];
  executionBudget: ProductionA5ExecutionBudget;
  postSchemaInvariants: ProductionA5InvariantExpectation[];
  postDataInvariants: ProductionA5InvariantExpectation[];
};

export type ProductionA5CatalogScope = {
  version: 1;
  schema: string;
  objectKinds: ['COLUMN', 'CONSTRAINT', 'ENUM_VALUE', 'INDEX', 'RELATION'];
};

export type ProductionA5ReviewedManifest = {
  schemaVersion: 3;
  catalogScope: ProductionA5CatalogScope;
  reviewedMigrationManifest: ProductionA5ReviewedMigrationOperation[];
  preSchemaCatalogObjects: ProductionA5SchemaObject[];
  postSchemaCatalogObjects: ProductionA5SchemaObject[];
  expectedSeededRoutes: ProductionA5Route[];
  expectedClosedWhtRoutes: ProductionA5Route[];
};

export type ProductionA5MigrationRiskSummary = {
  candidateCount: number;
  additiveCount: number;
  backwardCompatibleNonadditiveCount: number;
  dataBackfillCount: number;
  blockingContractCount: number;
  destructiveCustomerDataLossCount: 0;
  manualCustomerInputCount: 0;
  unreviewedCount: 0;
};

export type ProductionA5ManifestHashes = {
  candidateMigrationSetHash: string;
  reviewedMigrationOperationsHash: string;
  expectedSchemaDeltaHash: string;
  expectedDataTransformHash: string;
  preflightCatalogHash: string;
  lockBudgetPolicyHash: string;
  expectedSeededRouteHash: string;
  expectedClosedWhtRouteHash: string;
};

export type ProductionA5InvariantResult = ProductionA5InvariantExpectation & {
  migrationName: string;
  actualResultHash: string;
};

export type ProductionA5InvariantResultSet =
  | { status: 'NOT_RUN'; results: null; resultsHash: null }
  | { status: 'VERIFIED'; results: ProductionA5InvariantResult[]; resultsHash: string };

export type ProductionA5ExecutedMigration = {
  relativePath: string;
  migrationName: string;
  checksumSha256: string;
  executionOrder: number;
};

export type ProductionA5ExecutedMigrationSet =
  | { status: 'NOT_RUN'; migrations: null; migrationsHash: null }
  | { status: 'VERIFIED'; migrations: ProductionA5ExecutedMigration[]; migrationsHash: string };

export type ProductionA5BudgetObservation = {
  migrationName: string;
  maintenanceWindowId: string;
  effectiveLockTimeoutMs: number;
  effectiveStatementTimeoutMs: number;
  lockTimeoutEnforced: true;
  statementTimeoutEnforced: true;
  lockWaitBelowTimeout: true;
  observedStatementDurationMs: number;
  maintenanceWindowStartedAtEpochMs: number;
  maintenanceWindowFinishedAtEpochMs: number;
};

export type ProductionA5CloneRehearsal = {
  result: 'PASSED';
  engine: 'PostgreSQL';
  engineVersion: string;
  sourceDatabaseFingerprint: string;
  sourceAppliedMigrationsHash: string;
  sourceSchemaCatalogFingerprint: string;
  resultSchemaCatalogFingerprint: string;
  reviewedMigrationOperationsHash: string;
  expectedSchemaDeltaHash: string;
  expectedDataTransformHash: string;
  preconditionResults: ProductionA5InvariantResultSet;
  postSchemaResults: ProductionA5InvariantResultSet;
  postDataResults: ProductionA5InvariantResultSet;
  executedMigrations: ProductionA5ExecutedMigrationSet;
  executionBudgetResults: ProductionA5BudgetObservation[];
  executionBudgetResultsHash: string;
  cleanup: {
    status: 'DESTROYED';
    cloneIdentifierHash: string;
    destroyedAtEpochMs: number;
    residualObjectCount: 0;
  };
  resultHash: string;
};

export type ProductionA5VerificationEvidence = {
  cloneRehearsalRef: ProductionA5CloneChildRef;
  preconditionResults: ProductionA5InvariantResultSet;
  postSchemaResults: ProductionA5InvariantResultSet;
  postDataResults: ProductionA5InvariantResultSet;
  executedMigrations: ProductionA5ExecutedMigrationSet;
  executionBudgetResults: ProductionA5BudgetObservation[];
  executionBudgetResultsHash: string;
  cloneRehearsal: ProductionA5CloneRehearsal;
};

export type ProductionA5ServingBuild = {
  service: 'ai-gateway' | 'api-web' | 'workers';
  sourceCommit: string;
};

export type ProductionA5ChildRef = {
  artifactKind: 'PRODUCTION_A5_EVIDENCE_V1';
  producerRunId: string;
  producerRunAttempt: number;
  artifactName: string;
  contentSha256: string;
  artifactDigest: string;
};

export type ProductionA5CloneChildRef = Omit<ProductionA5ChildRef, 'artifactKind'> & {
  artifactKind: 'PRODUCTION_A5_CLONE_REHEARSAL_V1';
};

export type ProductionA5ApplyAuthority = {
  ownerApprovalRef: Omit<ProductionA5ChildRef, 'artifactKind'> & {
    artifactKind: 'OWNER_U5E_APPROVAL_V1';
  };
  maintenanceWindow: {
    windowId: string;
    startsAtEpochMs: number;
    endsAtEpochMs: number;
    failurePolicy: 'LEAVE_REIMBURSEMENT_QUIESCED_REQUIRE_FRESH_APPROVAL';
  };
};

export type ProductionA5ReimbursementRevisionProof = {
  sourceCommit: string;
  image: string;
  serviceRevisionArn: string;
  activeTaskArns: string[];
  quiesceEnabled: boolean;
  observedAtEpoch: number;
};

export type ProductionA5ReimbursementWriteQuiesce = {
  status: 'BRIDGE_ONLY_QUIESCED' | 'BRIDGE_ONLY_QUIESCED_POST_MIGRATION' | 'FINAL_ONLY_UNQUIESCED';
  acceptedFinalSourceCommit: string;
  acceptedFinalApiImage: string;
  bridgeProof: ProductionA5ReimbursementRevisionProof;
  finalQuiescedProof: ProductionA5ReimbursementRevisionProof | null;
  finalUnquiescedProof: ProductionA5ReimbursementRevisionProof | null;
  quiesceStartedAtEpoch: number;
  quiesceEndedAtEpoch: number | null;
  durationSeconds: number | null;
  blockedMutations: { status: 'AVAILABLE'; count: number } | { status: 'NOT_AVAILABLE'; count: null };
  reimbursementInvariantHash: string | null;
  allActiveTasksGuarded: true;
  allPreBridgeTasksRetired: true;
  allBridgeTasksRetired: true | null;
  sameFinalImageAcrossUnquiesce: true | null;
  failurePolicy: 'LEAVE_QUIESCED';
};

export type ProductionA5ReaderBoundary = {
  role: 'watchdog_a5_prod_ro';
  defaultReadOnly: true;
  transactionReadOnly: true;
  noTaskRole: true;
  nonPrivileged: true;
  noCreateOrDmlOrMaintain: true;
  noOutsideCoreSelect: true;
  noExecutableSecurityDefiner: true;
  noOwnershipOrMembership: true;
  coreRlsVisible: true;
};

export type ProductionA5Normalization =
  | { status: 'NOT_MATERIALIZED'; incomplete: null; drift: null; unexpectedOrigin: null }
  | { status: 'MATERIALIZED'; incomplete: number; drift: number; unexpectedOrigin: number };

/** Aggregate-only; request ids, amounts, descriptions and tenant values never leave the reader. */
export type ProductionA5ReimbursementApprovalSnapshots = {
  total: number;
  v2Valid: number;
  exactV1Compatible: number;
  missingHash: number;
  invalid: number;
  currentStepPending: number;
  legacyPartialApproved: number;
  legacyPartialRejected: number;
  invalidCurrentStep: number;
};

export type ProductionA5LaunchSnapshot = {
  featureLaunchStateHash: string;
  routes: Array<ProductionA5Route & { generation: number }>;
};

export type ProductionA5DatabaseSnapshot = {
  readerBoundary: ProductionA5ReaderBoundary;
  schemaObjects: ProductionA5SchemaObject[];
  appliedMigrations: ProductionA5MigrationIdentity[];
  preexistingEntitlementStateHash: string;
  preexistingAuthorityStateHash: string;
  effectiveOpenPolicyHash: string;
  safeOffAdmissionHash: string;
  allowListHash: string;
  reimbursementApprovalSnapshots: ProductionA5ReimbursementApprovalSnapshots;
  launch: ProductionA5LaunchSnapshot | null;
  normalization: ProductionA5Normalization;
};

type SchemaProfilePayload = {
  profile: 'LEGACY_PRE_F1_EXPECTED_ABSENT' | 'F1_REVIEWED_MATERIALIZED';
  scopeHash: string;
  expectedLegacyPresentRelations: string[];
  expectedLegacyAbsentRelations: string[];
  observedPresentRelations: string[];
  observedAbsentRelations: string[];
  observedPresentFingerprint: string;
  observedAbsentFingerprint: string;
  unexpectedPresent: string[];
  unexpectedMissing: string[];
};

type LaunchCatalogPayload =
  | { status: 'NOT_MATERIALIZED'; materialized: 0; expectedAfterMigration: 20; unexpected: 0 }
  | { status: 'MATERIALIZED'; materialized: 20; expectedAfterMigration: 20; unexpected: 0 };

type WhtMaterializationPayload =
  | {
    status: 'NOT_MATERIALIZED';
    actualCounts: null;
    actualRoutes: [];
    reviewedExpectedCounts: { total: 3; open: 0; closed: 3 };
    reviewedExpectedRoutes: ProductionA5Route[];
  }
  | {
    status: 'MATERIALIZED';
    actualCounts: { total: 3; open: 0; closed: 3 };
    actualRoutes: ProductionA5Route[];
    reviewedExpectedCounts: { total: 3; open: 0; closed: 3 };
    reviewedExpectedRoutes: ProductionA5Route[];
  };

export type ProductionA5Payload = {
  stage: ProductionA5Stage;
  targetEnvironment: 'production';
  readerBoundary: ProductionA5ReaderBoundary;
  queryCatalogHash: string;
  databaseFingerprint: string;
  schemaProfile: SchemaProfilePayload;
  schemaFingerprintScope: {
    included: ['tables', 'columns', 'types', 'defaults', 'nullability', 'identity', 'generated', 'indexes', 'constraints', 'enums'];
    excluded: ['triggers', 'views', 'policies'];
  };
  migrationState: ProductionA5ManifestHashes & {
    reviewedManifest: ProductionA5ReviewedManifest;
    migrationRiskSummary: ProductionA5MigrationRiskSummary;
    appliedMigrationsHash: string;
    candidateSetApplied: boolean;
    verificationEvidence: ProductionA5VerificationEvidence;
    productionApplyAuthority?: ProductionA5ApplyAuthority | null;
  };
  servingBuilds: ProductionA5ServingBuild[];
  reimbursementWriteQuiesce: ProductionA5ReimbursementWriteQuiesce;
  reimbursementApprovalSnapshots: ProductionA5ReimbursementApprovalSnapshots;
  authoritySnapshot: {
    preexistingEntitlementStateHash: string;
    preexistingAuthorityStateHash: string;
    effectiveOpenPolicyHash: string;
    safeOffAdmissionHash: string;
    allowListHash: string;
    featureLaunchStateHash: string | null;
    launchCatalog: LaunchCatalogPayload;
    whtMaterialization: WhtMaterializationPayload;
  };
  normalization: ProductionA5Normalization;
  baselineRefs: {
    preMutationRef: ProductionA5ChildRef | null;
    postMigrationRef: ProductionA5ChildRef | null;
  };
  comparisons: {
    preexistingEntitlementsUnchanged: boolean | null;
    preexistingAuthorityUnchanged: boolean | null;
    effectiveOpenPolicyUnchanged: boolean | null;
    safeOffAdmissionsUnchanged: boolean | null;
    allowListUnchanged: boolean | null;
    exactReviewedMigrationSetApplied: boolean | null;
    exactExpectedSchemaDeltaMaterialized: boolean | null;
    exactExpectedDataTransformsVerified: boolean | null;
    allPreflightConditionsSatisfied: boolean | null;
    lockBudgetSatisfied: boolean | null;
    exactReviewedSeedMaterialized: boolean | null;
    closedWhtMaterialized: boolean | null;
    postMigrationLaunchStateUnchanged: boolean | null;
  };
  currentHealth?: Record<string, unknown>;
  readerRuntime?: Record<string, unknown>;
  passed: boolean;
};

export type VerifiedProductionA5Baseline = {
  ref: ProductionA5ChildRef;
  payloadBytes: string;
};

export const PRODUCTION_A5_SCHEMA_FINGERPRINT_SCOPE: ProductionA5Payload['schemaFingerprintScope'] = {
  included: ['tables', 'columns', 'types', 'defaults', 'nullability', 'identity', 'generated', 'indexes', 'constraints', 'enums'],
  excluded: ['triggers', 'views', 'policies'],
};

export const PRODUCTION_A5_QUERY_CATALOG_HASH = hashValue({
  version: 4,
  profiles: ['LEGACY_PRE_F1_EXPECTED_ABSENT', 'F1_REVIEWED_MATERIALIZED'],
  schemaCatalog: 'explicit manifest schema + RELATION/COLUMN/INDEX/CONSTRAINT/ENUM_VALUE only',
  schemaFingerprintScope: PRODUCTION_A5_SCHEMA_FINGERPRINT_SCOPE,
  featureSchemaScope: PRODUCTION_A5_SCHEMA_SCOPE,
  hashes: [
    'reviewed PRE/POST explicit schema catalog objects and exact delta',
    'exact Git migration name/file SHA-256/operation class',
    'expected and actual PRE/post-schema/post-data result hashes',
    'executed migration order/checksum and bounded lock/statement/window observations',
    'production-clone rehearsal hash chain',
    'applied migration name/checksum rows',
    'preexisting entitlement full rows',
    'effective per-company authority',
    'aggregate classification of every pending reimbursement approval snapshot',
    'code-owned effective OPEN/Safe-OFF/allow-list policy',
    'materialized launch route state/generation',
  ],
});

function hashValue(value: unknown): string {
  return sha256(stableJson(value));
}

function compareRoute(left: { gateKey: string; routeKey: string }, right: { gateKey: string; routeKey: string }): number {
  if (left.gateKey !== right.gateKey) return left.gateKey < right.gateKey ? -1 : 1;
  return left.routeKey < right.routeKey ? -1 : left.routeKey > right.routeKey ? 1 : 0;
}

function schemaObjectKey(row: ProductionA5SchemaObject): string {
  return `${row.kind}\0${row.schema}\0${row.relation ?? ''}\0${row.name}`;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (stableJson(actual) !== stableJson(expected)) throw new Error(`${label}_fields_invalid`);
}

function objectOf(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}_invalid`);
  return value as Record<string, unknown>;
}

function stringOf(value: unknown, label: string): string {
  if (typeof value !== 'string' || value === '') throw new Error(`${label}_invalid`);
  return value;
}

function hashOf(value: unknown, label: string): string {
  const result = stringOf(value, label);
  if (!/^[0-9a-f]{64}$/.test(result)) throw new Error(`${label}_invalid`);
  return result;
}

function fullShaOf(value: unknown, label: string): string {
  const result = stringOf(value, label);
  if (!/^[0-9a-f]{40}$/.test(result)) throw new Error(`${label}_invalid`);
  return result;
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`${label}_invalid`);
  return Number(value);
}

function positiveInteger(value: unknown, label: string): number {
  const result = nonNegativeInteger(value, label);
  if (result === 0) throw new Error(`${label}_invalid`);
  return result;
}

function exactStringArray(value: unknown, expected: readonly string[], label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')
    || stableJson(value) !== stableJson(expected)) {
    throw new Error(`${label}_invalid`);
  }
  return value as string[];
}

function assertSortedUnique<T>(rows: readonly T[], keyOf: (row: T) => string, label: string): void {
  const keys = rows.map(keyOf);
  if (new Set(keys).size !== keys.length || keys.some((key, index) => index > 0 && keys[index - 1]! >= key)) {
    throw new Error(`${label}_must_be_stable_sorted_unique`);
  }
}

function parseRoute(value: unknown, label: string): ProductionA5Route {
  const row = objectOf(value, label);
  exactKeys(row, ['gateKey', 'routeKey', 'state'], label);
  const state = stringOf(row['state'], `${label}_state`);
  if (state !== 'OPEN' && state !== 'CLOSED') throw new Error(`${label}_state_invalid`);
  return {
    gateKey: stringOf(row['gateKey'], `${label}_gateKey`),
    routeKey: stringOf(row['routeKey'], `${label}_routeKey`),
    state,
  };
}

function parseSchemaObject(value: unknown, label: string): ProductionA5SchemaObject {
  const row = objectOf(value, label);
  exactKeys(row, ['kind', 'schema', 'relation', 'name', 'definition'], label);
  const kind = stringOf(row['kind'], `${label}_kind`);
  if (!['RELATION', 'COLUMN', 'INDEX', 'CONSTRAINT', 'ENUM_VALUE'].includes(kind)) {
    throw new Error(`${label}_kind_invalid`);
  }
  const relation = row['relation'];
  if (relation !== null && (typeof relation !== 'string' || relation === '')) {
    throw new Error(`${label}_relation_invalid`);
  }
  return {
    kind: kind as ProductionA5SchemaObject['kind'],
    schema: stringOf(row['schema'], `${label}_schema`),
    relation,
    name: stringOf(row['name'], `${label}_name`),
    definition: stringOf(row['definition'], `${label}_definition`),
  };
}

function parseInvariantExpectation(value: unknown, label: string): ProductionA5InvariantExpectation {
  const row = objectOf(value, label);
  exactKeys(row, ['id', 'queryHash', 'expectedResultHash'], label);
  const id = stringOf(row['id'], `${label}_id`);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{1,127}$/.test(id)) throw new Error(`${label}_id_invalid`);
  return {
    id,
    queryHash: hashOf(row['queryHash'], `${label}_query_hash`),
    expectedResultHash: hashOf(row['expectedResultHash'], `${label}_expected_result_hash`),
  };
}

function parseInvariantExpectations(value: unknown, label: string): ProductionA5InvariantExpectation[] {
  if (!Array.isArray(value)) throw new Error(`${label}_invalid`);
  const rows = value.map((row, index) => parseInvariantExpectation(row, `${label}_${index}`));
  assertSortedUnique(rows, (row) => row.id, label);
  return rows;
}

function boundedPositiveInteger(value: unknown, max: number, label: string): number {
  const result = positiveInteger(value, label);
  if (result > max) throw new Error(`${label}_exceeds_bound`);
  return result;
}

function parseExecutionBudget(value: unknown, label: string): ProductionA5ExecutionBudget {
  const row = objectOf(value, label);
  exactKeys(row, ['lockTimeoutMs', 'statementTimeoutMs'], label);
  return {
    lockTimeoutMs: boundedPositiveInteger(
      row['lockTimeoutMs'], PRODUCTION_A5_MAX_LOCK_TIMEOUT_MS, `${label}_lock_timeout`,
    ),
    statementTimeoutMs: boundedPositiveInteger(
      row['statementTimeoutMs'], PRODUCTION_A5_MAX_STATEMENT_TIMEOUT_MS, `${label}_statement_timeout`,
    ),
  };
}

function normalizedSql(sql: string): string {
  const withoutComments = sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\r\n]*/g, ' ');
  return withoutComments.replace(/\s+/g, ' ').toUpperCase();
}

function withoutRaiseMessageLiterals(sql: string): string {
  // PL/pgSQL RAISE messages are diagnostics, not executable SQL. Remove only the leading message
  // literal while retaining the surrounding function body and every other string literal.
  return sql.replace(
    /\bRAISE\s+(?:(?:DEBUG|LOG|INFO|NOTICE|WARNING|EXCEPTION)\s+)?'(?:''|[^'])*'/g,
    'RAISE',
  );
}

function dynamicExecutePayloads(sql: string): string[] {
  const payloads: string[] = [];
  const pattern = /\bEXECUTE\s+(?:FORMAT\s*\(\s*)?'((?:''|[^'])*)'/g;
  for (let match = pattern.exec(sql); match; match = pattern.exec(sql)) {
    payloads.push((match[1] ?? '').replace(/''/g, "'"));
  }
  return payloads;
}

/**
 * Shared fail-closed boundary for migration paths that do not carry the legacy per-migration
 * reviewed manifest. A destructive migration must use the separately reviewed A5 path instead of
 * the automatic UAT -> Production promotion path.
 */
export function assertProductionA5NoDestructiveSql(sqlBytes: string): void {
  const sql = normalizedSql(sqlBytes);
  const executableScan = withoutRaiseMessageLiterals(sql);
  const dynamicPayloads = dynamicExecutePayloads(sql);
  const withoutTempDrops = executableScan.replace(
    /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?PG_TEMP\.[A-Z0-9_".]+/g,
    ' ',
  );
  const destructiveScan = withoutTempDrops.replace(
    /\bCREATE\s+TRIGGER\s+(?:"[^"]+"|[A-Z_][A-Z0-9_$]*)\s+BEFORE\s+TRUNCATE\s+ON\s+(?:"[^"]+"|[A-Z_][A-Z0-9_$]*)\s+FOR\s+EACH\s+STATEMENT\s+EXECUTE\s+FUNCTION\s+(?:"[^"]+"|[A-Z_][A-Z0-9_$]*)\s*\(\s*\)/g,
    'CREATE TRIGGER',
  );
  const destructivePattern = /\b(?:DROP\s+(?:TABLE|COLUMN|TYPE|SCHEMA|DATABASE|VIEW|MATERIALIZED\s+VIEW|SEQUENCE)|TRUNCATE|DELETE\s+FROM)\b/;
  if (destructivePattern.test(destructiveScan)
    || dynamicPayloads.some((payload) => destructivePattern.test(normalizedSql(payload)))) {
    throw new Error('production_a5_destructive_data_loss_operation');
  }
}

function assertReviewedSqlOperation(
  operation: ProductionA5ReviewedMigrationOperation,
  sqlBytes: string,
): void {
  const sql = normalizedSql(sqlBytes);
  const executableScan = withoutRaiseMessageLiterals(sql);
  const dynamicPayloads = dynamicExecutePayloads(sql);
  // A bare UPDATE token also appears in FK clauses (`ON UPDATE CASCADE`). Only statement/block
  // boundaries classify DML; this still catches seed INSERTs and PL/pgSQL mutations.
  const mutationPattern = /(?:^|;|\bBEGIN\b|\bTHEN\b|\bELSE\b)\s*(?:UPDATE\b|INSERT\s+INTO\b|DELETE\s+FROM\b|MERGE\s+INTO\b)/;
  const dataMutation = mutationPattern.test(executableScan)
    || dynamicPayloads.some((payload) => mutationPattern.test(payload));
  const nonAdditive = /\b(?:DROP\s+(?:CONSTRAINT|INDEX|DEFAULT|NOT\s+NULL)|RENAME\s+(?:TO|CONSTRAINT)|CREATE\s+OR\s+REPLACE|ALTER\s+COLUMN\s+[^;]+\s+TYPE)\b/.test(executableScan);
  const blocking = /\b(?:SET\s+NOT\s+NULL|ADD\s+CONSTRAINT|CREATE\s+UNIQUE\s+INDEX|ALTER\s+TYPE\s+[^;]+\s+ADD\s+VALUE)\b/.test(executableScan);
  assertProductionA5NoDestructiveSql(sqlBytes);
  if (dataMutation && operation.operationClass !== 'DATA_BACKFILL') {
    throw new Error(`production_a5_data_mutation_class_mismatch:${operation.migrationName}`);
  }
  if (!dataMutation && operation.operationClass === 'DATA_BACKFILL') {
    throw new Error('production_a5_data_backfill_without_transform');
  }
  if (nonAdditive && operation.operationClass === 'ADDITIVE') {
    throw new Error('production_a5_nonadditive_operation_class_mismatch');
  }
  if ((nonAdditive || blocking || dataMutation || operation.operationClass !== 'ADDITIVE')
    && operation.preconditions.length === 0) {
    throw new Error('production_a5_suspicious_operation_without_preflight');
  }
  if (operation.preconditions.length === 0 || operation.postSchemaInvariants.length === 0) {
    throw new Error('production_a5_per_migration_invariant_catalog_incomplete');
  }
  if (operation.operationClass === 'DATA_BACKFILL' && operation.postDataInvariants.length === 0) {
    throw new Error('production_a5_data_backfill_without_post_invariant');
  }
  if (operation.operationClass !== 'DATA_BACKFILL' && operation.postDataInvariants.length !== 0) {
    throw new Error('production_a5_post_data_invariant_without_backfill');
  }
}

function validatedMigrationFiles(files: readonly ProductionA5MigrationFile[]): ProductionA5MigrationFile[] {
  const rows = files.map((file, index) => {
    if (!/^\d{14}_[a-z0-9_]+$/.test(file.name)) throw new Error(`production_a5_migration_file_${index}_name_invalid`);
    const fileSha256 = hashOf(file.fileSha256, `production_a5_migration_file_${index}_hash`);
    if (file.sqlBytes === '' || file.sqlBytes.includes('\0') || sha256(file.sqlBytes) !== fileSha256) {
      throw new Error(`production_a5_migration_file_${index}_bytes_mismatch`);
    }
    return { name: file.name, fileSha256, sqlBytes: file.sqlBytes };
  });
  assertSortedUnique(rows, (row) => row.name, 'production_a5_migration_files');
  return rows;
}

function parseReviewedMigrationOperation(value: unknown, index: number): ProductionA5ReviewedMigrationOperation {
  const label = `migration_operation_${index}`;
  const row = objectOf(value, label);
  exactKeys(row, [
    'relativePath', 'migrationName', 'checksumSha256', 'operationClass', 'preconditions',
    'executionBudget', 'postSchemaInvariants', 'postDataInvariants',
  ], label);
  const migrationName = stringOf(row['migrationName'], `${label}_name`);
  const relativePath = stringOf(row['relativePath'], `${label}_relative_path`);
  if (relativePath !== `apps/api/prisma/migrations/${migrationName}/migration.sql`) {
    throw new Error('production_a5_reviewed_migration_path_name_mismatch');
  }
  const operationClass = stringOf(row['operationClass'], `${label}_class`);
  if (!PRODUCTION_A5_MIGRATION_OPERATION_CLASSES.includes(operationClass as ProductionA5MigrationOperationClass)) {
    throw new Error(`${label}_class_invalid`);
  }
  const operation: ProductionA5ReviewedMigrationOperation = {
    relativePath,
    migrationName,
    checksumSha256: hashOf(row['checksumSha256'], `${label}_file_hash`),
    operationClass: operationClass as ProductionA5MigrationOperationClass,
    preconditions: parseInvariantExpectations(row['preconditions'], `${label}_preflight`),
    executionBudget: parseExecutionBudget(row['executionBudget'], `${label}_execution_budget`),
    postSchemaInvariants: parseInvariantExpectations(row['postSchemaInvariants'], `${label}_post_schema`),
    postDataInvariants: parseInvariantExpectations(row['postDataInvariants'], `${label}_post_data`),
  };
  if (operation.preconditions.length === 0 || operation.postSchemaInvariants.length === 0
    || (operation.operationClass === 'DATA_BACKFILL') !== (operation.postDataInvariants.length > 0)) {
    throw new Error('production_a5_per_migration_invariant_catalog_incomplete');
  }
  return operation;
}

function parseProductionA5ReviewedManifestShape(
  value: unknown,
  migrationFiles?: readonly ProductionA5MigrationFile[],
): ProductionA5ReviewedManifest {
  const input = objectOf(value, 'production_a5_manifest');
  exactKeys(input, [
    'schemaVersion', 'catalogScope', 'reviewedMigrationManifest', 'preSchemaCatalogObjects',
    'postSchemaCatalogObjects', 'expectedSeededRoutes', 'expectedClosedWhtRoutes',
  ], 'production_a5_manifest');
  if (input['schemaVersion'] !== 3) throw new Error('production_a5_manifest_schema_version_invalid');
  if (!Array.isArray(input['reviewedMigrationManifest']) || !Array.isArray(input['preSchemaCatalogObjects'])
    || !Array.isArray(input['postSchemaCatalogObjects']) || !Array.isArray(input['expectedSeededRoutes'])
    || !Array.isArray(input['expectedClosedWhtRoutes'])) {
    throw new Error('production_a5_manifest_arrays_invalid');
  }
  const scopeInput = objectOf(input['catalogScope'], 'catalog_scope');
  exactKeys(scopeInput, ['version', 'schema', 'objectKinds'], 'catalog_scope');
  const objectKinds = ['COLUMN', 'CONSTRAINT', 'ENUM_VALUE', 'INDEX', 'RELATION'] as const;
  const schema = stringOf(scopeInput['schema'], 'catalog_scope_schema');
  if (scopeInput['version'] !== 1 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)
    || stableJson(scopeInput['objectKinds']) !== stableJson(objectKinds)) {
    throw new Error('production_a5_catalog_scope_invalid');
  }
  const catalogScope: ProductionA5CatalogScope = { version: 1, schema, objectKinds: [...objectKinds] };
  const repositoryFiles = migrationFiles === undefined ? null : validatedMigrationFiles(migrationFiles);
  const repositoryByName = repositoryFiles === null
    ? null : new Map(repositoryFiles.map((file) => [file.name, file]));
  const reviewedMigrationManifest = input['reviewedMigrationManifest'].map((value, index) => {
    const operation = parseReviewedMigrationOperation(value, index);
    if (repositoryByName !== null) {
      const repositoryFile = repositoryByName.get(operation.migrationName);
      if (!repositoryFile || repositoryFile.fileSha256 !== operation.checksumSha256) {
        throw new Error('production_a5_reviewed_migration_git_bytes_mismatch');
      }
      assertReviewedSqlOperation(operation, repositoryFile.sqlBytes);
    }
    return operation;
  });
  const preSchemaCatalogObjects = input['preSchemaCatalogObjects']
    .map((value, index) => parseSchemaObject(value, `pre_schema_catalog_object_${index}`));
  const postSchemaCatalogObjects = input['postSchemaCatalogObjects']
    .map((value, index) => parseSchemaObject(value, `post_schema_catalog_object_${index}`));
  const expectedSeededRoutes = input['expectedSeededRoutes']
    .map((value, index) => parseRoute(value, `expected_seeded_route_${index}`));
  const expectedClosedWhtRoutes = input['expectedClosedWhtRoutes']
    .map((value, index) => parseRoute(value, `expected_wht_route_${index}`));
  assertSortedUnique(reviewedMigrationManifest, (row) => row.relativePath, 'migration_operations');
  if (reviewedMigrationManifest.length === 0) throw new Error('migration_operations_empty');
  assertSortedUnique(preSchemaCatalogObjects, schemaObjectKey, 'pre_schema_catalog_objects');
  assertSortedUnique(postSchemaCatalogObjects, schemaObjectKey, 'post_schema_catalog_objects');
  if ([...preSchemaCatalogObjects, ...postSchemaCatalogObjects].some((row) => row.schema !== schema)) {
    throw new Error('production_a5_schema_catalog_outside_scope');
  }
  assertSortedUnique(expectedSeededRoutes, (row) => `${row.gateKey}\0${row.routeKey}`, 'expected_seeded_routes');
  assertSortedUnique(expectedClosedWhtRoutes, (row) => `${row.gateKey}\0${row.routeKey}`, 'expected_wht_routes');
  if (stableJson(expectedSeededRoutes) !== stableJson(PRODUCTION_A5_EXPECTED_SEEDED_ROUTES)
    || stableJson(expectedClosedWhtRoutes) !== stableJson(PRODUCTION_A5_EXPECTED_CLOSED_WHT_ROUTES)) {
    throw new Error('production_a5_manifest_seed_catalog_mismatch');
  }
  return {
    schemaVersion: 3,
    catalogScope,
    reviewedMigrationManifest,
    preSchemaCatalogObjects,
    postSchemaCatalogObjects,
    expectedSeededRoutes,
    expectedClosedWhtRoutes,
  };
}

export function parseProductionA5ReviewedManifest(
  value: unknown,
  migrationFiles: readonly ProductionA5MigrationFile[],
): ProductionA5ReviewedManifest {
  return parseProductionA5ReviewedManifestShape(value, migrationFiles);
}

function schemaCatalogDelta(manifest: ProductionA5ReviewedManifest): Array<{
  key: string;
  before: ProductionA5SchemaObject | null;
  after: ProductionA5SchemaObject | null;
}> {
  const before = new Map(manifest.preSchemaCatalogObjects.map((row) => [schemaObjectKey(row), row]));
  const after = new Map(manifest.postSchemaCatalogObjects.map((row) => [schemaObjectKey(row), row]));
  return [...new Set([...before.keys(), ...after.keys()])].sort()
    .filter((key) => stableJson(before.get(key) ?? null) !== stableJson(after.get(key) ?? null))
    .map((key) => ({ key, before: before.get(key) ?? null, after: after.get(key) ?? null }));
}

export function productionA5MigrationRiskSummary(
  manifest: ProductionA5ReviewedManifest,
): ProductionA5MigrationRiskSummary {
  const count = (operationClass: ProductionA5MigrationOperationClass) => manifest.reviewedMigrationManifest
    .filter((row) => row.operationClass === operationClass).length;
  return {
    candidateCount: manifest.reviewedMigrationManifest.length,
    additiveCount: count('ADDITIVE'),
    backwardCompatibleNonadditiveCount: count('BACKWARD_COMPATIBLE_NONADDITIVE'),
    dataBackfillCount: count('DATA_BACKFILL'),
    blockingContractCount: count('BLOCKING_CONTRACT'),
    destructiveCustomerDataLossCount: 0,
    manualCustomerInputCount: 0,
    unreviewedCount: 0,
  };
}

export function productionA5ManifestHashes(manifest: ProductionA5ReviewedManifest): ProductionA5ManifestHashes {
  const candidateMigrations = manifest.reviewedMigrationManifest.map((row) => ({
    relativePath: row.relativePath,
    migrationName: row.migrationName,
    checksumSha256: row.checksumSha256,
  }));
  return {
    candidateMigrationSetHash: hashValue(candidateMigrations),
    reviewedMigrationOperationsHash: hashValue(manifest.reviewedMigrationManifest),
    expectedSchemaDeltaHash: hashValue(schemaCatalogDelta(manifest)),
    expectedDataTransformHash: hashValue(manifest.reviewedMigrationManifest
      .filter((row) => row.operationClass === 'DATA_BACKFILL')
      .map((row) => ({
        relativePath: row.relativePath,
        checksumSha256: row.checksumSha256,
        invariants: row.postDataInvariants,
      }))),
    preflightCatalogHash: hashValue(manifest.reviewedMigrationManifest
      .map((row) => ({ relativePath: row.relativePath, preconditions: row.preconditions }))),
    lockBudgetPolicyHash: hashValue(manifest.reviewedMigrationManifest
      .map((row) => ({ relativePath: row.relativePath, executionBudget: row.executionBudget }))),
    expectedSeededRouteHash: hashValue(manifest.expectedSeededRoutes),
    expectedClosedWhtRouteHash: hashValue(manifest.expectedClosedWhtRoutes),
  };
}

type InvariantCatalogKey = 'preconditions' | 'postSchemaInvariants' | 'postDataInvariants';

function expectedInvariantResults(
  operations: readonly ProductionA5ReviewedMigrationOperation[],
  key: InvariantCatalogKey,
): Array<Omit<ProductionA5InvariantResult, 'actualResultHash'>> {
  return operations.flatMap((operation) => operation[key].map((invariant) => ({
    migrationName: operation.migrationName,
    ...invariant,
  })));
}

function parseInvariantResult(value: unknown, label: string): ProductionA5InvariantResult {
  const row = objectOf(value, label);
  exactKeys(row, ['migrationName', 'id', 'queryHash', 'expectedResultHash', 'actualResultHash'], label);
  const expectation = parseInvariantExpectation({
    id: row['id'], queryHash: row['queryHash'], expectedResultHash: row['expectedResultHash'],
  }, `${label}_expectation`);
  return {
    migrationName: stringOf(row['migrationName'], `${label}_migration_name`),
    ...expectation,
    actualResultHash: hashOf(row['actualResultHash'], `${label}_actual_result_hash`),
  };
}

function parseInvariantResultSet(
  value: unknown,
  label: string,
  expected: Array<Omit<ProductionA5InvariantResult, 'actualResultHash'>>,
  mustRun: boolean,
): ProductionA5InvariantResultSet {
  const row = objectOf(value, label);
  exactKeys(row, ['status', 'results', 'resultsHash'], label);
  if (!mustRun) {
    if (row['status'] !== 'NOT_RUN' || row['results'] !== null || row['resultsHash'] !== null) {
      throw new Error(`${label}_must_be_not_run`);
    }
    return { status: 'NOT_RUN', results: null, resultsHash: null };
  }
  if (row['status'] !== 'VERIFIED' || !Array.isArray(row['results'])) {
    throw new Error(`${label}_must_be_verified`);
  }
  const results = row['results'].map((item, index) => parseInvariantResult(item, `${label}_${index}`));
  assertSortedUnique(results, (item) => `${item.migrationName}\0${item.id}`, label);
  if (hashOf(row['resultsHash'], `${label}_results_hash`) !== hashValue(results)) {
    throw new Error(`${label}_result_hash_mismatch`);
  }
  const actualCatalog = results.map(({ actualResultHash: _actual, ...item }) => item);
  if (stableJson(actualCatalog) !== stableJson(expected)
    || results.some((item) => item.actualResultHash !== item.expectedResultHash)) {
    throw new Error(`${label}_actual_result_mismatch`);
  }
  return { status: 'VERIFIED', results, resultsHash: hashValue(results) };
}

function parseExecutedMigrationSet(
  value: unknown,
  operations: readonly ProductionA5ReviewedMigrationOperation[],
  mustRun: boolean,
): ProductionA5ExecutedMigrationSet {
  const row = objectOf(value, 'executed_migrations');
  exactKeys(row, ['status', 'migrations', 'migrationsHash'], 'executed_migrations');
  if (!mustRun) {
    if (row['status'] !== 'NOT_RUN' || row['migrations'] !== null || row['migrationsHash'] !== null) {
      throw new Error('production_a5_executed_migrations_must_be_not_run');
    }
    return { status: 'NOT_RUN', migrations: null, migrationsHash: null };
  }
  if (row['status'] !== 'VERIFIED' || !Array.isArray(row['migrations'])) {
    throw new Error('production_a5_executed_migrations_must_be_verified');
  }
  const migrations = row['migrations'].map((value, index): ProductionA5ExecutedMigration => {
    const item = objectOf(value, `executed_migration_${index}`);
    exactKeys(item, ['relativePath', 'migrationName', 'checksumSha256', 'executionOrder'], `executed_migration_${index}`);
    return {
      relativePath: stringOf(item['relativePath'], `executed_migration_${index}_path`),
      migrationName: stringOf(item['migrationName'], `executed_migration_${index}_name`),
      checksumSha256: hashOf(item['checksumSha256'], `executed_migration_${index}_checksum`),
      executionOrder: positiveInteger(item['executionOrder'], `executed_migration_${index}_order`),
    };
  });
  assertSortedUnique(migrations, (item) => item.relativePath, 'executed_migrations');
  const reviewed = operations.map(({ relativePath, migrationName, checksumSha256 }) => ({
    relativePath, migrationName, checksumSha256,
  }));
  const actual = migrations.map(({ executionOrder: _order, ...item }) => item);
  if (stableJson(actual) !== stableJson(reviewed)
    || migrations.some((item, index) => index > 0 && item.executionOrder <= migrations[index - 1]!.executionOrder)) {
    throw new Error('production_a5_executed_migration_set_or_order_mismatch');
  }
  if (hashOf(row['migrationsHash'], 'executed_migrations_hash') !== hashValue(migrations)) {
    throw new Error('production_a5_executed_migrations_hash_mismatch');
  }
  return { status: 'VERIFIED', migrations, migrationsHash: hashValue(migrations) };
}

function parseBudgetObservation(value: unknown, index: number): ProductionA5BudgetObservation {
  const label = `execution_budget_result_${index}`;
  const row = objectOf(value, label);
  exactKeys(row, [
    'migrationName', 'maintenanceWindowId', 'effectiveLockTimeoutMs', 'effectiveStatementTimeoutMs',
    'lockTimeoutEnforced', 'statementTimeoutEnforced', 'lockWaitBelowTimeout',
    'observedStatementDurationMs', 'maintenanceWindowStartedAtEpochMs',
    'maintenanceWindowFinishedAtEpochMs',
  ], label);
  if (row['effectiveLockTimeoutMs'] !== 2_000 || row['effectiveStatementTimeoutMs'] !== 300_000
    || row['lockTimeoutEnforced'] !== true || row['statementTimeoutEnforced'] !== true
    || row['lockWaitBelowTimeout'] !== true) {
    throw new Error(`${label}_strict_timeout_policy_not_proven`);
  }
  return {
    migrationName: stringOf(row['migrationName'], `${label}_migration_name`),
    maintenanceWindowId: stringOf(row['maintenanceWindowId'], `${label}_window_id`),
    effectiveLockTimeoutMs: 2_000,
    effectiveStatementTimeoutMs: 300_000,
    lockTimeoutEnforced: true,
    statementTimeoutEnforced: true,
    lockWaitBelowTimeout: true,
    observedStatementDurationMs: nonNegativeInteger(
      row['observedStatementDurationMs'], `${label}_observed_statement_duration`,
    ),
    maintenanceWindowStartedAtEpochMs: positiveInteger(
      row['maintenanceWindowStartedAtEpochMs'], `${label}_window_started`,
    ),
    maintenanceWindowFinishedAtEpochMs: positiveInteger(
      row['maintenanceWindowFinishedAtEpochMs'], `${label}_window_finished`,
    ),
  };
}

function parseBudgetObservations(
  value: unknown,
  hash: unknown,
  operations: readonly ProductionA5ReviewedMigrationOperation[],
): ProductionA5BudgetObservation[] {
  if (!Array.isArray(value)) throw new Error('production_a5_execution_budget_results_invalid');
  const results = value.map(parseBudgetObservation);
  assertSortedUnique(results, (item) => item.migrationName, 'execution_budget_results');
  if (hashOf(hash, 'execution_budget_results_hash') !== hashValue(results)) {
    throw new Error('production_a5_execution_budget_results_hash_mismatch');
  }
  const expectedByName = new Map(operations.map((operation) => [operation.migrationName, operation.executionBudget]));
  if (results.length !== operations.length) throw new Error('production_a5_execution_budget_result_set_mismatch');
  const windowIds = new Set(results.map((result) => result.maintenanceWindowId));
  const windowStart = Math.min(...results.map((result) => result.maintenanceWindowStartedAtEpochMs));
  const windowEnd = Math.max(...results.map((result) => result.maintenanceWindowFinishedAtEpochMs));
  if (windowIds.size !== 1 || windowEnd - windowStart > PRODUCTION_A5_MAX_MAINTENANCE_WINDOW_MS) {
    throw new Error('production_a5_execution_window_invalid');
  }
  for (const result of results) {
    const expected = expectedByName.get(result.migrationName);
    if (!expected || result.effectiveLockTimeoutMs > expected.lockTimeoutMs
      || result.effectiveStatementTimeoutMs > expected.statementTimeoutMs
      || result.observedStatementDurationMs > expected.statementTimeoutMs
      || result.maintenanceWindowFinishedAtEpochMs <= result.maintenanceWindowStartedAtEpochMs
      || result.maintenanceWindowFinishedAtEpochMs - result.maintenanceWindowStartedAtEpochMs
        > PRODUCTION_A5_MAX_MAINTENANCE_WINDOW_MS) {
      throw new Error('production_a5_execution_budget_not_satisfied');
    }
  }
  return results;
}

function parseCloneRehearsal(
  value: unknown,
  operations: readonly ProductionA5ReviewedMigrationOperation[],
  hashes: ProductionA5ManifestHashes,
  expectedSourceAppliedMigrationsHash: string,
  expectedCatalogFingerprints?: { source: string; result: string },
): ProductionA5CloneRehearsal {
  const row = objectOf(value, 'clone_rehearsal');
  const keys = [
    'result', 'engine', 'engineVersion', 'sourceDatabaseFingerprint', 'sourceSchemaCatalogFingerprint',
    'sourceAppliedMigrationsHash',
    'resultSchemaCatalogFingerprint', 'reviewedMigrationOperationsHash', 'expectedSchemaDeltaHash',
    'expectedDataTransformHash', 'preconditionResults', 'postSchemaResults', 'postDataResults',
    'executedMigrations', 'executionBudgetResults', 'executionBudgetResultsHash', 'cleanup', 'resultHash',
  ] as const;
  exactKeys(row, keys, 'clone_rehearsal');
  if (row['result'] !== 'PASSED' || row['engine'] !== 'PostgreSQL'
    || typeof row['engineVersion'] !== 'string' || !/^18(?:\.\d+){1,2}$/.test(row['engineVersion'])) {
    throw new Error('production_a5_clone_rehearsal_not_passed');
  }
  for (const key of [
    'sourceDatabaseFingerprint', 'sourceAppliedMigrationsHash', 'sourceSchemaCatalogFingerprint',
    'reviewedMigrationOperationsHash', 'expectedSchemaDeltaHash', 'expectedDataTransformHash',
    'executionBudgetResultsHash', 'resultHash',
  ]) hashOf(row[key], `clone_rehearsal_${key}`);
  if (row['sourceAppliedMigrationsHash'] !== expectedSourceAppliedMigrationsHash
    || row['reviewedMigrationOperationsHash'] !== hashes.reviewedMigrationOperationsHash
    || row['expectedSchemaDeltaHash'] !== hashes.expectedSchemaDeltaHash
    || row['expectedDataTransformHash'] !== hashes.expectedDataTransformHash
    || (expectedCatalogFingerprints
      && (row['sourceSchemaCatalogFingerprint'] !== expectedCatalogFingerprints.source
        || row['resultSchemaCatalogFingerprint'] !== expectedCatalogFingerprints.result))) {
    throw new Error('production_a5_clone_rehearsal_contract_mismatch');
  }
  const preconditionResults = parseInvariantResultSet(
    row['preconditionResults'], 'clone_precondition_results', expectedInvariantResults(operations, 'preconditions'), true,
  );
  const postSchemaResults = parseInvariantResultSet(
    row['postSchemaResults'], 'clone_post_schema_results', expectedInvariantResults(operations, 'postSchemaInvariants'),
    true,
  );
  const postDataResults = parseInvariantResultSet(
    row['postDataResults'], 'clone_post_data_results', expectedInvariantResults(operations, 'postDataInvariants'), true,
  );
  const executedMigrations = parseExecutedMigrationSet(row['executedMigrations'], operations, true);
  const executionBudgetResults = parseBudgetObservations(
    row['executionBudgetResults'], row['executionBudgetResultsHash'], operations,
  );
  const cleanup = objectOf(row['cleanup'], 'clone_rehearsal_cleanup');
  exactKeys(cleanup, [
    'status', 'cloneIdentifierHash', 'destroyedAtEpochMs', 'residualObjectCount',
  ], 'clone_rehearsal_cleanup');
  if (cleanup['status'] !== 'DESTROYED' || cleanup['residualObjectCount'] !== 0) {
    throw new Error('production_a5_clone_rehearsal_cleanup_failed');
  }
  hashOf(cleanup['cloneIdentifierHash'], 'clone_rehearsal_clone_identifier_hash');
  positiveInteger(cleanup['destroyedAtEpochMs'], 'clone_rehearsal_destroyed_at');
  const { resultHash: _resultHash, ...resultFacts } = row;
  if (row['resultHash'] !== hashValue(resultFacts)) throw new Error('production_a5_clone_rehearsal_hash_mismatch');
  return {
    ...row,
    preconditionResults,
    postSchemaResults,
    postDataResults,
    executedMigrations,
    executionBudgetResults,
    executionBudgetResultsHash: hashValue(executionBudgetResults),
    cleanup: cleanup as ProductionA5CloneRehearsal['cleanup'],
  } as unknown as ProductionA5CloneRehearsal;
}

function parseVerificationEvidence(
  value: unknown,
  stage: ProductionA5Stage,
  operations: readonly ProductionA5ReviewedMigrationOperation[],
  hashes: ProductionA5ManifestHashes,
  cloneSourceAppliedMigrationsHash: string,
  cloneCatalogFingerprints?: { source: string; result: string },
): ProductionA5VerificationEvidence {
  const row = objectOf(value, 'verification_evidence');
  exactKeys(row, [
    'preconditionResults', 'postSchemaResults', 'postDataResults', 'executedMigrations',
    'executionBudgetResults', 'executionBudgetResultsHash', 'cloneRehearsal', 'cloneRehearsalRef',
  ], 'verification_evidence');
  const cloneRehearsalRef = cloneChildRefOf(row['cloneRehearsalRef'], 'clone_rehearsal_ref');
  const postMustRun = stage !== 'PRE_MUTATION';
  const preconditionResults = parseInvariantResultSet(
    row['preconditionResults'], 'precondition_results', expectedInvariantResults(operations, 'preconditions'), true,
  );
  const postSchemaResults = parseInvariantResultSet(
    row['postSchemaResults'], 'post_schema_results', expectedInvariantResults(operations, 'postSchemaInvariants'),
    postMustRun,
  );
  const postDataResults = parseInvariantResultSet(
    row['postDataResults'], 'post_data_results', expectedInvariantResults(operations, 'postDataInvariants'), postMustRun,
  );
  const executedMigrations = parseExecutedMigrationSet(row['executedMigrations'], operations, postMustRun);
  const executionBudgetResults = parseBudgetObservations(
    row['executionBudgetResults'], row['executionBudgetResultsHash'], operations,
  );
  const cloneRehearsal = parseCloneRehearsal(
    row['cloneRehearsal'], operations, hashes, cloneSourceAppliedMigrationsHash, cloneCatalogFingerprints,
  );
  if (stage === 'PRE_MUTATION'
    && (stableJson(cloneRehearsal.preconditionResults) !== stableJson(preconditionResults)
      || cloneRehearsal.executionBudgetResultsHash !== hashValue(executionBudgetResults))) {
    throw new Error('production_a5_clone_rehearsal_actual_evidence_mismatch');
  }
  return {
    cloneRehearsalRef,
    preconditionResults,
    postSchemaResults,
    postDataResults,
    executedMigrations,
    executionBudgetResults,
    executionBudgetResultsHash: hashValue(executionBudgetResults),
    cloneRehearsal,
  };
}

export function parseProductionA5VerificationEvidence(
  value: unknown,
  stage: ProductionA5Stage,
  manifest: ProductionA5ReviewedManifest,
  cloneSourceAppliedMigrationsHash: string,
): ProductionA5VerificationEvidence {
  hashOf(cloneSourceAppliedMigrationsHash, 'clone_source_applied_migrations_hash');
  return parseVerificationEvidence(
    value,
    stage,
    manifest.reviewedMigrationManifest,
    productionA5ManifestHashes(manifest),
    cloneSourceAppliedMigrationsHash,
    {
      source: hashValue(manifest.preSchemaCatalogObjects),
      result: hashValue(manifest.postSchemaCatalogObjects),
    },
  );
}

export function parseProductionA5ServingBuilds(value: unknown): ProductionA5ServingBuild[] {
  if (!Array.isArray(value)) throw new Error('production_a5_serving_builds_invalid');
  const rows = value.map((value, index) => {
    const row = objectOf(value, `serving_build_${index}`);
    exactKeys(row, ['service', 'sourceCommit'], `serving_build_${index}`);
    const service = stringOf(row['service'], `serving_build_${index}_service`);
    if (!['ai-gateway', 'api-web', 'workers'].includes(service)) throw new Error('serving_build_service_invalid');
    return { service: service as ProductionA5ServingBuild['service'], sourceCommit: fullShaOf(row['sourceCommit'], 'serving_build_sha') };
  }).sort((a, b) => a.service < b.service ? -1 : a.service > b.service ? 1 : 0);
  if (stableJson(rows.map((row) => row.service)) !== stableJson(['ai-gateway', 'api-web', 'workers'])) {
    throw new Error('production_a5_serving_build_set_invalid');
  }
  return rows;
}

export function productionA5PolicyHashes(): Pick<ProductionA5DatabaseSnapshot,
  'effectiveOpenPolicyHash' | 'safeOffAdmissionHash' | 'allowListHash'> {
  const effectiveOpenPolicy = MATERIALIZABLE_LAUNCH_MATRIX_ROWS
    .map((row) => ({ gateKey: row.gateKey, routeKey: row.routeKey, openPolicy: row.openPolicy ?? 'ALLOWED' }))
    .sort(compareRoute);
  // Freeze-in-place (owner decision 2026-08-04): the admission policy is no longer a per-surface
  // runoff verdict — every sellable family may be switched off and only a platform invariant may
  // not. Hashed so a deploy still proves the policy did not change under it.
  //
  // Submenus resolve to their parent first, exactly like the command and read paths that enforce
  // this (`set-partner-features.use-case.ts:143`, `get-partner-detail.use-case.ts:103`) — otherwise
  // `company_settings.security` and `employee_access.employees` would be projected as clear-to-off
  // here while the command refuses to write them.
  const safeOffAdmissions = [...ALL_FEATURE_ENTITLEMENT_KEYS].sort().map((featureKey) => ({
    featureKey,
    clear: !PLATFORM_INVARIANT_FEATURE_KEYS.includes(parentFeatureKey(featureKey)),
  }));
  return {
    effectiveOpenPolicyHash: hashValue(effectiveOpenPolicy),
    safeOffAdmissionHash: hashValue({
      policy: 'FREEZE_IN_PLACE',
      admissions: safeOffAdmissions,
    }),
    allowListHash: hashValue(safeOffAdmissions.filter((row) => row.clear).map((row) => row.featureKey)),
  };
}

function schemaProfileOf(
  stage: ProductionA5Stage,
  catalogScope: ProductionA5CatalogScope,
  objects: readonly ProductionA5SchemaObject[],
): SchemaProfilePayload {
  const relations = new Set(objects.filter((row) => row.kind === 'RELATION').map((row) => row.name));
  const observedPresentRelations = PRODUCTION_A5_SCHEMA_SCOPE.filter((name) => relations.has(name));
  const observedAbsentRelations = PRODUCTION_A5_SCHEMA_SCOPE.filter((name) => !relations.has(name));
  const expectedPresent = stage === 'PRE_MUTATION'
    ? [...PRODUCTION_A5_LEGACY_PRESENT_RELATIONS]
    : [...PRODUCTION_A5_SCHEMA_SCOPE];
  const expectedAbsent = stage === 'PRE_MUTATION' ? [...PRODUCTION_A5_LEGACY_ABSENT_RELATIONS] : [];
  const unexpectedPresent = observedPresentRelations.filter((name) => !expectedPresent.includes(name));
  const unexpectedMissing = expectedPresent.filter((name) => !observedPresentRelations.includes(name));
  const absentObjects = observedAbsentRelations
    .map((relation) => ({ schema: catalogScope.schema, relation, kind: 'ABSENT' }));
  return {
    profile: stage === 'PRE_MUTATION' ? 'LEGACY_PRE_F1_EXPECTED_ABSENT' : 'F1_REVIEWED_MATERIALIZED',
    scopeHash: hashValue({
      expectedLegacyPresentRelations: PRODUCTION_A5_LEGACY_PRESENT_RELATIONS,
      expectedLegacyAbsentRelations: PRODUCTION_A5_LEGACY_ABSENT_RELATIONS,
    }),
    expectedLegacyPresentRelations: [...PRODUCTION_A5_LEGACY_PRESENT_RELATIONS],
    expectedLegacyAbsentRelations: [...PRODUCTION_A5_LEGACY_ABSENT_RELATIONS],
    observedPresentRelations,
    observedAbsentRelations,
    observedPresentFingerprint: hashValue(objects),
    observedAbsentFingerprint: hashValue(absentObjects),
    unexpectedPresent,
    unexpectedMissing,
  };
}

function activeMigrationMap(rows: readonly ProductionA5MigrationIdentity[]): Map<string, string> {
  if (new Set(rows.map((row) => row.name)).size !== rows.length
    || rows.some((row, index) => !Number.isSafeInteger(row.appliedOrder) || row.appliedOrder <= 0
      || (index > 0 && row.appliedOrder <= rows[index - 1]!.appliedOrder))) {
    throw new Error('applied_migrations_order_invalid');
  }
  return new Map(rows.map((row) => [row.name, row.checksum]));
}

function actualRoutes(launch: ProductionA5LaunchSnapshot): ProductionA5Route[] {
  return launch.routes.map(({ gateKey, routeKey, state }) => ({ gateKey, routeKey, state })).sort(compareRoute);
}

function signedChildRefOf<TKind extends ProductionA5ChildRef['artifactKind'] | ProductionA5CloneChildRef['artifactKind']>(
  value: unknown,
  label: string,
  expectedKind: TKind,
): Omit<ProductionA5ChildRef, 'artifactKind'> & { artifactKind: TKind } {
  const row = objectOf(value, label);
  exactKeys(row, [
    'artifactKind', 'producerRunId', 'producerRunAttempt', 'artifactName', 'contentSha256', 'artifactDigest',
  ], label);
  if (row['artifactKind'] !== expectedKind) throw new Error(`${label}_kind_invalid`);
  const producerRunId = stringOf(row['producerRunId'], `${label}_run_id`);
  if (!/^[1-9][0-9]*$/.test(producerRunId)) throw new Error(`${label}_run_id_invalid`);
  const artifactDigest = stringOf(row['artifactDigest'], `${label}_artifact_digest`);
  if (!/^sha256:[0-9a-f]{64}$/.test(artifactDigest)) throw new Error(`${label}_artifact_digest_invalid`);
  const artifactName = stringOf(row['artifactName'], `${label}_artifact_name`);
  if (artifactName.length > 255 || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(artifactName)) {
    throw new Error(`${label}_artifact_name_invalid`);
  }
  return {
    artifactKind: expectedKind,
    producerRunId,
    producerRunAttempt: positiveInteger(row['producerRunAttempt'], `${label}_attempt`),
    artifactName,
    contentSha256: hashOf(row['contentSha256'], `${label}_content_hash`),
    artifactDigest,
  };
}

function childRefOf(value: unknown, label: string): ProductionA5ChildRef {
  return signedChildRefOf(value, label, 'PRODUCTION_A5_EVIDENCE_V1');
}

function cloneChildRefOf(value: unknown, label: string): ProductionA5CloneChildRef {
  return signedChildRefOf(value, label, 'PRODUCTION_A5_CLONE_REHEARSAL_V1');
}

function parseReimbursementRevisionProof(
  value: unknown,
  label: string,
  quiesceEnabled: boolean,
): ProductionA5ReimbursementRevisionProof {
  const row = objectOf(value, label);
  exactKeys(row, [
    'sourceCommit', 'image', 'serviceRevisionArn', 'activeTaskArns', 'quiesceEnabled',
    'observedAtEpoch',
  ], label);
  const sourceCommit = fullShaOf(row['sourceCommit'], `${label}_source_commit`);
  const image = stringOf(row['image'], `${label}_image`);
  const serviceRevisionArn = stringOf(row['serviceRevisionArn'], `${label}_revision`);
  if (!/^\d{12}\.dkr\.ecr\.ap-southeast-1\.amazonaws\.com\/watchdog-bms-api@sha256:[0-9a-f]{64}$/.test(image)
    || !/^arn:aws:ecs:ap-southeast-1:311414082667:service-revision\/[^/]+\/[^/]+\/[^/]+$/.test(
      serviceRevisionArn,
    )
    || !Array.isArray(row['activeTaskArns']) || row['activeTaskArns'].length === 0
    || row['activeTaskArns'].some((arn) => typeof arn !== 'string'
      || !/^arn:aws:ecs:ap-southeast-1:311414082667:task\/[^/]+\/[^/]+$/.test(arn))
    || row['quiesceEnabled'] !== quiesceEnabled) {
    throw new Error(`${label}_invalid`);
  }
  const activeTaskArns = row['activeTaskArns'] as string[];
  assertSortedUnique(activeTaskArns, (arn) => arn, `${label}_active_tasks`);
  return {
    sourceCommit,
    image,
    serviceRevisionArn,
    activeTaskArns,
    quiesceEnabled,
    observedAtEpoch: positiveInteger(row['observedAtEpoch'], `${label}_observed_at`),
  };
}

export function parseProductionA5ReimbursementWriteQuiesce(
  value: unknown,
  stage: ProductionA5Stage,
  sourceCommit: string,
): ProductionA5ReimbursementWriteQuiesce {
  const row = objectOf(value, 'reimbursement_write_quiesce');
  exactKeys(row, [
    'status', 'acceptedFinalSourceCommit', 'acceptedFinalApiImage', 'bridgeProof',
    'finalQuiescedProof', 'finalUnquiescedProof', 'quiesceStartedAtEpoch',
    'quiesceEndedAtEpoch', 'durationSeconds', 'blockedMutations',
    'reimbursementInvariantHash', 'allActiveTasksGuarded', 'allPreBridgeTasksRetired',
    'allBridgeTasksRetired', 'sameFinalImageAcrossUnquiesce', 'failurePolicy',
  ], 'reimbursement_write_quiesce');
  const acceptedFinalSourceCommit = fullShaOf(
    row['acceptedFinalSourceCommit'], 'reimbursement_accepted_source',
  );
  const acceptedFinalApiImage = stringOf(row['acceptedFinalApiImage'], 'reimbursement_accepted_image');
  if (acceptedFinalSourceCommit !== sourceCommit
    || !/^\d{12}\.dkr\.ecr\.ap-southeast-1\.amazonaws\.com\/watchdog-bms-api@sha256:[0-9a-f]{64}$/.test(
      acceptedFinalApiImage,
    )
    || row['allActiveTasksGuarded'] !== true || row['allPreBridgeTasksRetired'] !== true
    || row['failurePolicy'] !== 'LEAVE_QUIESCED') {
    throw new Error('reimbursement_write_quiesce_identity_invalid');
  }
  const bridgeProof = parseReimbursementRevisionProof(row['bridgeProof'], 'reimbursement_bridge_proof', true);
  const quiesceStartedAtEpoch = positiveInteger(
    row['quiesceStartedAtEpoch'], 'reimbursement_quiesce_started_at',
  );
  if (quiesceStartedAtEpoch > bridgeProof.observedAtEpoch) {
    throw new Error('reimbursement_quiesce_start_invalid');
  }
  const blocked = objectOf(row['blockedMutations'], 'reimbursement_blocked_mutations');
  exactKeys(blocked, ['status', 'count'], 'reimbursement_blocked_mutations');
  const blockedMutations = blocked['status'] === 'AVAILABLE'
    ? { status: 'AVAILABLE' as const, count: nonNegativeInteger(blocked['count'], 'reimbursement_blocked_count') }
    : blocked['status'] === 'NOT_AVAILABLE' && blocked['count'] === null
      ? { status: 'NOT_AVAILABLE' as const, count: null }
      : (() => { throw new Error('reimbursement_blocked_mutations_invalid'); })();
  const common = {
    acceptedFinalSourceCommit,
    acceptedFinalApiImage,
    bridgeProof,
    quiesceStartedAtEpoch,
    blockedMutations,
    allActiveTasksGuarded: true as const,
    allPreBridgeTasksRetired: true as const,
    failurePolicy: 'LEAVE_QUIESCED' as const,
  };
  if (stage === 'PRE_MUTATION' || stage === 'POST_MIGRATION') {
    const expectedStatus = stage === 'PRE_MUTATION'
      ? 'BRIDGE_ONLY_QUIESCED' : 'BRIDGE_ONLY_QUIESCED_POST_MIGRATION';
    const invariant = stage === 'POST_MIGRATION'
      ? hashOf(row['reimbursementInvariantHash'], 'reimbursement_invariant_hash') : null;
    if (row['status'] !== expectedStatus || row['finalQuiescedProof'] !== null
      || row['finalUnquiescedProof'] !== null || row['quiesceEndedAtEpoch'] !== null
      || row['durationSeconds'] !== null || row['allBridgeTasksRetired'] !== null
      || row['sameFinalImageAcrossUnquiesce'] !== null
      || (stage === 'PRE_MUTATION' && row['reimbursementInvariantHash'] !== null)) {
      throw new Error('reimbursement_write_quiesce_stage_invalid');
    }
    return {
      status: expectedStatus,
      ...common,
      finalQuiescedProof: null,
      finalUnquiescedProof: null,
      quiesceEndedAtEpoch: null,
      durationSeconds: null,
      reimbursementInvariantHash: invariant,
      allBridgeTasksRetired: null,
      sameFinalImageAcrossUnquiesce: null,
    };
  }
  const finalQuiescedProof = parseReimbursementRevisionProof(
    row['finalQuiescedProof'], 'reimbursement_final_quiesced_proof', true,
  );
  const finalUnquiescedProof = parseReimbursementRevisionProof(
    row['finalUnquiescedProof'], 'reimbursement_final_unquiesced_proof', false,
  );
  const quiesceEndedAtEpoch = positiveInteger(
    row['quiesceEndedAtEpoch'], 'reimbursement_quiesce_ended_at',
  );
  const durationSeconds = nonNegativeInteger(row['durationSeconds'], 'reimbursement_quiesce_duration');
  const reimbursementInvariantHash = hashOf(
    row['reimbursementInvariantHash'], 'reimbursement_invariant_hash',
  );
  if (row['status'] !== 'FINAL_ONLY_UNQUIESCED'
    || finalQuiescedProof.sourceCommit !== acceptedFinalSourceCommit
    || finalUnquiescedProof.sourceCommit !== acceptedFinalSourceCommit
    || finalQuiescedProof.image !== acceptedFinalApiImage
    || finalUnquiescedProof.image !== acceptedFinalApiImage
    || finalQuiescedProof.serviceRevisionArn === finalUnquiescedProof.serviceRevisionArn
    || finalQuiescedProof.observedAtEpoch > finalUnquiescedProof.observedAtEpoch
    || finalUnquiescedProof.observedAtEpoch > quiesceEndedAtEpoch
    || durationSeconds !== quiesceEndedAtEpoch - quiesceStartedAtEpoch || durationSeconds > 1800
    || row['allBridgeTasksRetired'] !== true || row['sameFinalImageAcrossUnquiesce'] !== true) {
    throw new Error('reimbursement_write_quiesce_final_invalid');
  }
  return {
    status: 'FINAL_ONLY_UNQUIESCED',
    ...common,
    finalQuiescedProof,
    finalUnquiescedProof,
    quiesceEndedAtEpoch,
    durationSeconds,
    reimbursementInvariantHash,
    allBridgeTasksRetired: true,
    sameFinalImageAcrossUnquiesce: true,
  };
}

export function parseProductionA5ReimbursementApprovalSnapshots(
  value: unknown,
): ProductionA5ReimbursementApprovalSnapshots {
  const snapshots = objectOf(value, 'reimbursement_approval_snapshots');
  exactKeys(snapshots, [
    'total', 'v2Valid', 'exactV1Compatible', 'missingHash', 'invalid',
    'currentStepPending', 'legacyPartialApproved', 'legacyPartialRejected', 'invalidCurrentStep',
  ], 'reimbursement_approval_snapshots');
  const parsed = {
    total: nonNegativeInteger(snapshots['total'], 'reimbursement_approval_snapshots_total'),
    v2Valid: nonNegativeInteger(snapshots['v2Valid'], 'reimbursement_approval_snapshots_v2_valid'),
    exactV1Compatible: nonNegativeInteger(
      snapshots['exactV1Compatible'], 'reimbursement_approval_snapshots_exact_v1_compatible',
    ),
    missingHash: nonNegativeInteger(
      snapshots['missingHash'], 'reimbursement_approval_snapshots_missing_hash',
    ),
    invalid: nonNegativeInteger(snapshots['invalid'], 'reimbursement_approval_snapshots_invalid'),
    currentStepPending: nonNegativeInteger(
      snapshots['currentStepPending'], 'reimbursement_approval_snapshots_current_step_pending',
    ),
    legacyPartialApproved: nonNegativeInteger(
      snapshots['legacyPartialApproved'], 'reimbursement_approval_snapshots_legacy_partial_approved',
    ),
    legacyPartialRejected: nonNegativeInteger(
      snapshots['legacyPartialRejected'], 'reimbursement_approval_snapshots_legacy_partial_rejected',
    ),
    invalidCurrentStep: nonNegativeInteger(
      snapshots['invalidCurrentStep'], 'reimbursement_approval_snapshots_invalid_current_step',
    ),
  };
  if (parsed.total !== parsed.v2Valid + parsed.exactV1Compatible + parsed.missingHash + parsed.invalid) {
    throw new Error('production_a5_reimbursement_approval_snapshots_total_mismatch');
  }
  if (parsed.missingHash !== 0 || parsed.invalid !== 0) {
    throw new Error('production_a5_reimbursement_approval_snapshots_not_clean');
  }
  if (parsed.total !== parsed.currentStepPending + parsed.legacyPartialApproved
    + parsed.legacyPartialRejected + parsed.invalidCurrentStep) {
    throw new Error('production_a5_reimbursement_approval_step_total_mismatch');
  }
  if (parsed.legacyPartialApproved !== 0 || parsed.legacyPartialRejected !== 0
    || parsed.invalidCurrentStep !== 0) {
    throw new Error('production_a5_reimbursement_approval_steps_not_clean');
  }
  return parsed;
}

function assertPayloadKeys(payload: Record<string, unknown>): void {
  const controllerFields = Object.hasOwn(payload, 'currentHealth') || Object.hasOwn(payload, 'readerRuntime');
  if (Object.hasOwn(payload, 'currentHealth') !== Object.hasOwn(payload, 'readerRuntime')) {
    throw new Error('production_a5_controller_fields_incomplete');
  }
  exactKeys(payload, [
    'stage', 'targetEnvironment', 'readerBoundary', 'queryCatalogHash', 'databaseFingerprint',
    'schemaProfile', 'schemaFingerprintScope', 'migrationState', 'servingBuilds', 'authoritySnapshot',
    'reimbursementWriteQuiesce', 'reimbursementApprovalSnapshots', 'normalization',
    'baselineRefs', 'comparisons', 'passed',
    ...(controllerFields ? ['currentHealth', 'readerRuntime'] : []),
  ], 'production_a5_payload');
  exactKeys(objectOf(payload['readerBoundary'], 'reader_boundary'), [
    'role', 'defaultReadOnly', 'transactionReadOnly', 'noTaskRole', 'nonPrivileged',
    'noCreateOrDmlOrMaintain', 'noOutsideCoreSelect', 'noExecutableSecurityDefiner',
    'noOwnershipOrMembership', 'coreRlsVisible',
  ], 'reader_boundary');
  exactKeys(objectOf(payload['schemaProfile'], 'schema_profile'), [
    'profile', 'scopeHash', 'expectedLegacyPresentRelations', 'expectedLegacyAbsentRelations',
    'observedPresentRelations', 'observedAbsentRelations', 'observedPresentFingerprint',
    'observedAbsentFingerprint', 'unexpectedPresent', 'unexpectedMissing',
  ], 'schema_profile');
  exactKeys(objectOf(payload['schemaFingerprintScope'], 'schema_fingerprint_scope'), [
    'included', 'excluded',
  ], 'schema_fingerprint_scope');
  const migration = objectOf(payload['migrationState'], 'migration_state');
  exactKeys(migration, [
    'appliedMigrationsHash', 'candidateMigrationSetHash', 'reviewedMigrationOperationsHash',
    'expectedSchemaDeltaHash', 'expectedDataTransformHash', 'preflightCatalogHash',
    'lockBudgetPolicyHash', 'expectedSeededRouteHash', 'expectedClosedWhtRouteHash',
    'reviewedManifest', 'migrationRiskSummary', 'candidateSetApplied', 'verificationEvidence',
    ...(Object.hasOwn(migration, 'productionApplyAuthority') ? ['productionApplyAuthority'] : []),
  ], 'migration_state');
  exactKeys(objectOf(payload['authoritySnapshot'], 'authority_snapshot'), [
    'preexistingEntitlementStateHash', 'preexistingAuthorityStateHash', 'effectiveOpenPolicyHash',
    'safeOffAdmissionHash', 'allowListHash', 'featureLaunchStateHash', 'launchCatalog',
    'whtMaterialization',
  ], 'authority_snapshot');
  exactKeys(objectOf(payload['baselineRefs'], 'baseline_refs'), ['preMutationRef', 'postMigrationRef'], 'baseline_refs');
  exactKeys(objectOf(payload['comparisons'], 'comparisons'), [
    'preexistingEntitlementsUnchanged', 'preexistingAuthorityUnchanged', 'effectiveOpenPolicyUnchanged',
    'safeOffAdmissionsUnchanged', 'allowListUnchanged', 'exactReviewedMigrationSetApplied',
    'exactExpectedSchemaDeltaMaterialized', 'exactExpectedDataTransformsVerified',
    'allPreflightConditionsSatisfied', 'lockBudgetSatisfied', 'exactReviewedSeedMaterialized',
    'closedWhtMaterialized', 'postMigrationLaunchStateUnchanged',
  ], 'comparisons');
  if (controllerFields) {
    objectOf(payload['currentHealth'], 'current_health');
    objectOf(payload['readerRuntime'], 'reader_runtime');
  }
}

function assertProductionApplyAuthority(value: unknown, stage: ProductionA5Stage): void {
  if (stage === 'PRE_MUTATION') {
    if (value !== null) throw new Error('production_a5_pre_apply_authority_invalid');
    return;
  }
  const authority = objectOf(value, 'production_apply_authority');
  exactKeys(authority, ['maintenanceWindow', 'ownerApprovalRef'], 'production_apply_authority');
  const owner = objectOf(authority['ownerApprovalRef'], 'production_apply_owner_ref');
  exactKeys(owner, [
    'artifactKind', 'producerRunId', 'producerRunAttempt', 'artifactName', 'contentSha256', 'artifactDigest',
  ], 'production_apply_owner_ref');
  if (owner['artifactKind'] !== 'OWNER_U5E_APPROVAL_V1'
    || !/^[1-9][0-9]*$/.test(stringOf(owner['producerRunId'], 'production_apply_owner_run'))
    || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(stringOf(owner['artifactName'], 'production_apply_owner_name'))
    || !/^sha256:[0-9a-f]{64}$/.test(stringOf(owner['artifactDigest'], 'production_apply_owner_digest'))) {
    throw new Error('production_a5_apply_owner_ref_invalid');
  }
  positiveInteger(owner['producerRunAttempt'], 'production_apply_owner_attempt');
  hashOf(owner['contentSha256'], 'production_apply_owner_content');
  const window = objectOf(authority['maintenanceWindow'], 'production_apply_window');
  exactKeys(window, [
    'endsAtEpochMs', 'failurePolicy', 'startsAtEpochMs', 'windowId',
  ], 'production_apply_window');
  const starts = positiveInteger(window['startsAtEpochMs'], 'production_apply_window_starts');
  const ends = positiveInteger(window['endsAtEpochMs'], 'production_apply_window_ends');
  if (!/^u5e-[1-9][0-9]*-a[1-9][0-9]*-[1-9][0-9]*-a[1-9][0-9]*$/.test(
    stringOf(window['windowId'], 'production_apply_window_id'),
  ) || ends <= starts || ends - starts > 1_800_000
    || window['failurePolicy'] !== 'LEAVE_REIMBURSEMENT_QUIESCED_REQUIRE_FRESH_APPROVAL') {
    throw new Error('production_a5_apply_window_invalid');
  }
}

function assertProductionA5PayloadShape(payload: Record<string, unknown>): ProductionA5Payload {
  assertPayloadKeys(payload);
  if (!PRODUCTION_A5_STAGES.includes(payload['stage'] as ProductionA5Stage)
    || payload['targetEnvironment'] !== 'production') throw new Error('production_a5_baseline_identity_invalid');
  for (const key of ['queryCatalogHash', 'databaseFingerprint']) hashOf(payload[key], key);

  const reader = objectOf(payload['readerBoundary'], 'reader_boundary');
  if (reader['role'] !== 'watchdog_a5_prod_ro'
    || Object.entries(reader).some(([key, value]) => key !== 'role' && value !== true)) {
    throw new Error('production_a5_baseline_reader_boundary_invalid');
  }

  const schema = objectOf(payload['schemaProfile'], 'schema_profile');
  if (!['LEGACY_PRE_F1_EXPECTED_ABSENT', 'F1_REVIEWED_MATERIALIZED'].includes(String(schema['profile']))) {
    throw new Error('production_a5_schema_profile_invalid');
  }
  for (const key of ['scopeHash', 'observedPresentFingerprint', 'observedAbsentFingerprint']) {
    hashOf(schema[key], `schema_profile_${key}`);
  }
  if (stableJson(payload['schemaFingerprintScope']) !== stableJson(PRODUCTION_A5_SCHEMA_FINGERPRINT_SCOPE)) {
    throw new Error('schema_fingerprint_scope_invalid');
  }
  exactStringArray(schema['expectedLegacyPresentRelations'], PRODUCTION_A5_LEGACY_PRESENT_RELATIONS,
    'expected_legacy_present_relations');
  exactStringArray(schema['expectedLegacyAbsentRelations'], PRODUCTION_A5_LEGACY_ABSENT_RELATIONS,
    'expected_legacy_absent_relations');
  for (const key of ['observedPresentRelations', 'observedAbsentRelations', 'unexpectedPresent', 'unexpectedMissing']) {
    if (!Array.isArray(schema[key]) || schema[key].some((item) => typeof item !== 'string')) {
      throw new Error(`schema_profile_${key}_invalid`);
    }
    assertSortedUnique(schema[key] as string[], (item) => item, `schema_profile_${key}`);
  }

  const migration = objectOf(payload['migrationState'], 'migration_state');
  if (Object.hasOwn(migration, 'productionApplyAuthority')) {
    assertProductionApplyAuthority(migration['productionApplyAuthority'], payload['stage'] as ProductionA5Stage);
  }
  for (const key of [
    'appliedMigrationsHash', 'candidateMigrationSetHash',
    'reviewedMigrationOperationsHash', 'expectedSchemaDeltaHash', 'expectedDataTransformHash',
    'preflightCatalogHash', 'lockBudgetPolicyHash', 'expectedSeededRouteHash', 'expectedClosedWhtRouteHash',
  ]) hashOf(migration[key], key);
  const reviewedManifest = parseProductionA5ReviewedManifestShape(migration['reviewedManifest']);
  const reviewedMigrationManifest = reviewedManifest.reviewedMigrationManifest;
  const reviewedHashes = productionA5ManifestHashes(reviewedManifest);
  if (migration['reviewedMigrationOperationsHash'] !== reviewedHashes.reviewedMigrationOperationsHash
    || migration['candidateMigrationSetHash'] !== hashValue(reviewedMigrationManifest.map((row) => ({
      relativePath: row.relativePath,
      migrationName: row.migrationName,
      checksumSha256: row.checksumSha256,
    })))
    || (Object.keys(reviewedHashes) as Array<keyof ProductionA5ManifestHashes>)
      .some((key) => migration[key] !== reviewedHashes[key])) {
    throw new Error('production_a5_reviewed_migration_manifest_hash_mismatch');
  }
  const risk = objectOf(migration['migrationRiskSummary'], 'migration_risk_summary');
  exactKeys(risk, [
    'candidateCount', 'additiveCount', 'backwardCompatibleNonadditiveCount', 'dataBackfillCount',
    'blockingContractCount', 'destructiveCustomerDataLossCount', 'manualCustomerInputCount',
    'unreviewedCount',
  ], 'migration_risk_summary');
  for (const key of [
    'candidateCount', 'additiveCount', 'backwardCompatibleNonadditiveCount', 'dataBackfillCount',
    'blockingContractCount',
  ]) {
    nonNegativeInteger(risk[key], `migration_risk_${key}`);
  }
  if (risk['candidateCount'] !== Number(risk['additiveCount'])
    + Number(risk['backwardCompatibleNonadditiveCount']) + Number(risk['dataBackfillCount'])
    + Number(risk['blockingContractCount'])
    || risk['destructiveCustomerDataLossCount'] !== 0 || risk['manualCustomerInputCount'] !== 0
    || risk['unreviewedCount'] !== 0
    || typeof migration['candidateSetApplied'] !== 'boolean') {
    throw new Error('production_a5_migration_state_invalid');
  }
  const derivedCounts = productionA5MigrationRiskSummary({
    schemaVersion: 3,
    catalogScope: { version: 1, schema: 'public', objectKinds: ['COLUMN', 'CONSTRAINT', 'ENUM_VALUE', 'INDEX', 'RELATION'] },
    reviewedMigrationManifest,
    preSchemaCatalogObjects: [], postSchemaCatalogObjects: [], expectedSeededRoutes: [], expectedClosedWhtRoutes: [],
  });
  if (stableJson(risk) !== stableJson(derivedCounts)) {
    throw new Error('production_a5_migration_risk_summary_not_derived');
  }
  const hashes: ProductionA5ManifestHashes = {
    candidateMigrationSetHash: String(migration['candidateMigrationSetHash']),
    reviewedMigrationOperationsHash: String(migration['reviewedMigrationOperationsHash']),
    expectedSchemaDeltaHash: String(migration['expectedSchemaDeltaHash']),
    expectedDataTransformHash: String(migration['expectedDataTransformHash']),
    preflightCatalogHash: String(migration['preflightCatalogHash']),
    lockBudgetPolicyHash: String(migration['lockBudgetPolicyHash']),
    expectedSeededRouteHash: String(migration['expectedSeededRouteHash']),
    expectedClosedWhtRouteHash: String(migration['expectedClosedWhtRouteHash']),
  };
  if (hashes.expectedDataTransformHash !== hashValue(reviewedMigrationManifest
    .filter((row) => row.operationClass === 'DATA_BACKFILL')
    .map((row) => ({
      relativePath: row.relativePath,
      checksumSha256: row.checksumSha256,
      invariants: row.postDataInvariants,
    })))
    || hashes.preflightCatalogHash !== hashValue(reviewedMigrationManifest
      .map((row) => ({ relativePath: row.relativePath, preconditions: row.preconditions })))
    || hashes.lockBudgetPolicyHash !== hashValue(reviewedMigrationManifest
      .map((row) => ({ relativePath: row.relativePath, executionBudget: row.executionBudget })))) {
    throw new Error('production_a5_reviewed_operation_catalog_hash_mismatch');
  }
  const rawVerification = objectOf(migration['verificationEvidence'], 'verification_evidence');
  const rawClone = objectOf(rawVerification['cloneRehearsal'], 'clone_rehearsal');
  const cloneSourceAppliedMigrationsHash = payload['stage'] === 'PRE_MUTATION'
    ? String(migration['appliedMigrationsHash'])
    : hashOf(rawClone['sourceAppliedMigrationsHash'], 'clone_source_applied_migrations_hash');
  parseVerificationEvidence(
    rawVerification, payload['stage'] as ProductionA5Stage, reviewedMigrationManifest, hashes,
    cloneSourceAppliedMigrationsHash,
  );

  if (!Array.isArray(payload['servingBuilds'])) throw new Error('production_a5_baseline_serving_builds_invalid');
  const servingBuilds = parseProductionA5ServingBuilds(payload['servingBuilds']);
  if (stableJson(servingBuilds) !== stableJson(payload['servingBuilds'])) {
    throw new Error('production_a5_baseline_serving_builds_not_sorted');
  }
  const rawQuiesce = objectOf(payload['reimbursementWriteQuiesce'], 'reimbursement_write_quiesce');
  parseProductionA5ReimbursementWriteQuiesce(
    rawQuiesce,
    payload['stage'] as ProductionA5Stage,
    fullShaOf(rawQuiesce['acceptedFinalSourceCommit'], 'reimbursement_accepted_source'),
  );
  parseProductionA5ReimbursementApprovalSnapshots(payload['reimbursementApprovalSnapshots']);

  const authority = objectOf(payload['authoritySnapshot'], 'authority_snapshot');
  for (const key of [
    'preexistingEntitlementStateHash', 'preexistingAuthorityStateHash', 'effectiveOpenPolicyHash',
    'safeOffAdmissionHash', 'allowListHash',
  ]) hashOf(authority[key], `authority_${key}`);
  if (authority['featureLaunchStateHash'] !== null) hashOf(authority['featureLaunchStateHash'], 'feature_launch_state_hash');

  const launch = objectOf(authority['launchCatalog'], 'launch_catalog');
  exactKeys(launch, ['status', 'materialized', 'expectedAfterMigration', 'unexpected'], 'launch_catalog');
  if (!['NOT_MATERIALIZED', 'MATERIALIZED'].includes(String(launch['status']))) {
    throw new Error('launch_catalog_status_invalid');
  }
  for (const key of ['materialized', 'expectedAfterMigration', 'unexpected']) {
    nonNegativeInteger(launch[key], `launch_catalog_${key}`);
  }

  const wht = objectOf(authority['whtMaterialization'], 'wht_materialization');
  exactKeys(wht, ['status', 'actualCounts', 'actualRoutes', 'reviewedExpectedCounts', 'reviewedExpectedRoutes'],
    'wht_materialization');
  if (!['NOT_MATERIALIZED', 'MATERIALIZED'].includes(String(wht['status']))) {
    throw new Error('wht_materialization_status_invalid');
  }
  const reviewedCounts = objectOf(wht['reviewedExpectedCounts'], 'wht_reviewed_counts');
  exactKeys(reviewedCounts, ['total', 'open', 'closed'], 'wht_reviewed_counts');
  if (reviewedCounts['total'] !== 3 || reviewedCounts['open'] !== 0 || reviewedCounts['closed'] !== 3) {
    throw new Error('wht_reviewed_counts_invalid');
  }
  if (!Array.isArray(wht['reviewedExpectedRoutes'])) throw new Error('wht_reviewed_routes_invalid');
  const expectedWht = wht['reviewedExpectedRoutes'].map((row, index) => parseRoute(row, `wht_reviewed_route_${index}`));
  if (stableJson(expectedWht) !== stableJson(PRODUCTION_A5_EXPECTED_CLOSED_WHT_ROUTES)) {
    throw new Error('wht_reviewed_routes_invalid');
  }
  if (!Array.isArray(wht['actualRoutes'])) throw new Error('wht_actual_routes_invalid');
  const actualWht = wht['actualRoutes'].map((row, index) => parseRoute(row, `wht_actual_route_${index}`));
  if (wht['actualCounts'] !== null) {
    const counts = objectOf(wht['actualCounts'], 'wht_actual_counts');
    exactKeys(counts, ['total', 'open', 'closed'], 'wht_actual_counts');
    for (const key of ['total', 'open', 'closed']) nonNegativeInteger(counts[key], `wht_actual_${key}`);
  }
  assertSortedUnique(actualWht, (row) => `${row.gateKey}\0${row.routeKey}`, 'wht_actual_routes');

  const normalization = objectOf(payload['normalization'], 'normalization');
  exactKeys(normalization, ['status', 'incomplete', 'drift', 'unexpectedOrigin'], 'normalization');
  if (normalization['status'] !== 'NOT_MATERIALIZED' && normalization['status'] !== 'MATERIALIZED') {
    throw new Error('normalization_status_invalid');
  }
  if (normalization['status'] === 'NOT_MATERIALIZED') {
    if (normalization['incomplete'] !== null || normalization['drift'] !== null
      || normalization['unexpectedOrigin'] !== null) throw new Error('normalization_not_materialized_invalid');
  } else {
    for (const key of ['incomplete', 'drift', 'unexpectedOrigin']) {
      nonNegativeInteger(normalization[key], `normalization_${key}`);
    }
  }

  const refs = objectOf(payload['baselineRefs'], 'baseline_refs');
  if (refs['preMutationRef'] !== null) childRefOf(refs['preMutationRef'], 'pre_mutation_ref');
  if (refs['postMigrationRef'] !== null) childRefOf(refs['postMigrationRef'], 'post_migration_ref');

  const comparisons = objectOf(payload['comparisons'], 'comparisons');
  for (const [key, value] of Object.entries(comparisons)) {
    if (value !== null && typeof value !== 'boolean') throw new Error(`comparison_${key}_invalid`);
  }
  if (payload['passed'] !== true) throw new Error('production_a5_baseline_not_passed');
  return payload as unknown as ProductionA5Payload;
}

/** Parse only already signature/transport-validated H2 payload bytes; unknown fields still fail. */
export function parseVerifiedProductionA5Payload(bytes: string): ProductionA5Payload {
  let parsed: unknown;
  try { parsed = JSON.parse(bytes); } catch { throw new Error('production_a5_baseline_json_invalid'); }
  const payload = assertProductionA5PayloadShape(objectOf(parsed, 'production_a5_payload'));
  assertProductionA5StageInvariant(payload);
  return payload;
}

function validatedBaseline(input: VerifiedProductionA5Baseline | undefined, stage: ProductionA5Stage): {
  ref: ProductionA5ChildRef;
  payload: ProductionA5Payload;
} {
  if (!input) throw new Error(`production_a5_${stage.toLowerCase()}_baseline_required`);
  const ref = childRefOf(input.ref, `${stage.toLowerCase()}_ref`);
  const payload = parseVerifiedProductionA5Payload(input.payloadBytes);
  if (payload.stage !== stage) throw new Error('production_a5_baseline_stage_order_invalid');
  assertProductionA5StageInvariant(payload);
  return { ref, payload };
}

function assertProductionA5StageInvariant(payload: ProductionA5Payload): void {
  const allTrue = (values: unknown[]) => values.every((value) => value === true);
  assertProductionA5PayloadShape(payload as unknown as Record<string, unknown>);
  if (payload.queryCatalogHash !== PRODUCTION_A5_QUERY_CATALOG_HASH) throw new Error('production_a5_query_catalog_mismatch');
  const scopeHash = hashValue({
    expectedLegacyPresentRelations: PRODUCTION_A5_LEGACY_PRESENT_RELATIONS,
    expectedLegacyAbsentRelations: PRODUCTION_A5_LEGACY_ABSENT_RELATIONS,
  });
  if (payload.schemaProfile.scopeHash !== scopeHash
    || payload.migrationState.expectedSeededRouteHash !== hashValue(PRODUCTION_A5_EXPECTED_SEEDED_ROUTES)
    || payload.migrationState.expectedClosedWhtRouteHash !== hashValue(PRODUCTION_A5_EXPECTED_CLOSED_WHT_ROUTES)
    || payload.migrationState.migrationRiskSummary.candidateCount === 0) {
    throw new Error('production_a5_reviewed_contract_mismatch');
  }
  if (payload.schemaProfile.unexpectedPresent.length !== 0 || payload.schemaProfile.unexpectedMissing.length !== 0) {
    throw new Error('production_a5_schema_profile_not_clean');
  }
  if (payload.stage === 'PRE_MUTATION') {
    if (payload.schemaProfile.profile !== 'LEGACY_PRE_F1_EXPECTED_ABSENT'
      || stableJson(payload.schemaProfile.observedPresentRelations) !== stableJson(PRODUCTION_A5_LEGACY_PRESENT_RELATIONS)
      || stableJson(payload.schemaProfile.observedAbsentRelations) !== stableJson(PRODUCTION_A5_LEGACY_ABSENT_RELATIONS)
      || payload.migrationState.candidateSetApplied !== false
      || payload.authoritySnapshot.featureLaunchStateHash !== null
      || payload.authoritySnapshot.launchCatalog.status !== 'NOT_MATERIALIZED'
      || payload.authoritySnapshot.launchCatalog.materialized !== 0
      || payload.authoritySnapshot.launchCatalog.expectedAfterMigration !== 20
      || payload.authoritySnapshot.launchCatalog.unexpected !== 0
      || payload.authoritySnapshot.whtMaterialization.status !== 'NOT_MATERIALIZED'
      || payload.authoritySnapshot.whtMaterialization.actualCounts !== null
      || payload.authoritySnapshot.whtMaterialization.actualRoutes.length !== 0
      || payload.normalization.status !== 'NOT_MATERIALIZED'
      || payload.baselineRefs.preMutationRef !== null || payload.baselineRefs.postMigrationRef !== null
      || Object.values(payload.comparisons).some((value) => value !== null)) {
      throw new Error('production_a5_pre_invariant_failed');
    }
    return;
  }
  const comparisons = payload.comparisons;
  const common = [
    comparisons.preexistingEntitlementsUnchanged,
    comparisons.preexistingAuthorityUnchanged,
    comparisons.effectiveOpenPolicyUnchanged,
    comparisons.safeOffAdmissionsUnchanged,
    comparisons.allowListUnchanged,
    comparisons.exactReviewedMigrationSetApplied,
    comparisons.exactExpectedSchemaDeltaMaterialized,
    comparisons.exactExpectedDataTransformsVerified,
    comparisons.allPreflightConditionsSatisfied,
    comparisons.lockBudgetSatisfied,
    comparisons.exactReviewedSeedMaterialized,
    comparisons.closedWhtMaterialized,
  ];
  if (payload.schemaProfile.profile !== 'F1_REVIEWED_MATERIALIZED'
    || stableJson(payload.schemaProfile.observedPresentRelations) !== stableJson(PRODUCTION_A5_SCHEMA_SCOPE)
    || payload.schemaProfile.observedAbsentRelations.length !== 0
    || payload.migrationState.candidateSetApplied !== true
    || payload.authoritySnapshot.featureLaunchStateHash === null
    || payload.authoritySnapshot.launchCatalog.status !== 'MATERIALIZED'
    || payload.authoritySnapshot.launchCatalog.materialized !== 20
    || payload.authoritySnapshot.launchCatalog.expectedAfterMigration !== 20
    || payload.authoritySnapshot.launchCatalog.unexpected !== 0
    || payload.authoritySnapshot.whtMaterialization.status !== 'MATERIALIZED'
    || stableJson(payload.authoritySnapshot.whtMaterialization.actualCounts) !== stableJson({ total: 3, open: 0, closed: 3 })
    || stableJson(payload.authoritySnapshot.whtMaterialization.actualRoutes) !== stableJson(PRODUCTION_A5_EXPECTED_CLOSED_WHT_ROUTES)
    || payload.normalization.status !== 'MATERIALIZED'
    || payload.normalization.incomplete !== 0 || payload.normalization.drift !== 0
    || payload.normalization.unexpectedOrigin !== 0
    || !allTrue(common)
    || payload.baselineRefs.preMutationRef === null) {
    throw new Error('production_a5_post_invariant_failed');
  }
  if (payload.stage === 'POST_MIGRATION') {
    if (payload.baselineRefs.postMigrationRef !== null || comparisons.postMigrationLaunchStateUnchanged !== null) {
      throw new Error('production_a5_post_migration_invariant_failed');
    }
  } else if (payload.baselineRefs.postMigrationRef === null
    || comparisons.postMigrationLaunchStateUnchanged !== true) {
    throw new Error('production_a5_post_deployment_invariant_failed');
  }
}

export function productionA5DatabaseFingerprint(snapshot: ProductionA5DatabaseSnapshot): string {
  return hashValue({
    schema: snapshot.schemaObjects,
    appliedMigrationsHash: hashValue(snapshot.appliedMigrations),
    preexistingEntitlementStateHash: snapshot.preexistingEntitlementStateHash,
    preexistingAuthorityStateHash: snapshot.preexistingAuthorityStateHash,
    effectiveOpenPolicyHash: snapshot.effectiveOpenPolicyHash,
    safeOffAdmissionHash: snapshot.safeOffAdmissionHash,
    allowListHash: snapshot.allowListHash,
    reimbursementApprovalSnapshots: snapshot.reimbursementApprovalSnapshots,
    featureLaunchStateHash: snapshot.launch?.featureLaunchStateHash ?? null,
  });
}

export function buildProductionA5Payload(input: {
  stage: ProductionA5Stage;
  sourceCommit: string;
  manifest: ProductionA5ReviewedManifest;
  migrationFiles: ProductionA5MigrationFile[];
  snapshot: ProductionA5DatabaseSnapshot;
  verificationEvidence: ProductionA5VerificationEvidence;
  servingBuilds: ProductionA5ServingBuild[];
  reimbursementWriteQuiesce: ProductionA5ReimbursementWriteQuiesce;
  preMutationBaseline?: VerifiedProductionA5Baseline;
  postMigrationBaseline?: VerifiedProductionA5Baseline;
}): ProductionA5Payload {
  fullShaOf(input.sourceCommit, 'production_a5_source_commit');
  const servingBuilds = parseProductionA5ServingBuilds(input.servingBuilds);
  const reimbursementWriteQuiesce = parseProductionA5ReimbursementWriteQuiesce(
    input.reimbursementWriteQuiesce,
    input.stage,
    input.sourceCommit,
  );
  const reimbursementApprovalSnapshots = parseProductionA5ReimbursementApprovalSnapshots(
    input.snapshot.reimbursementApprovalSnapshots,
  );
  const repositoryFiles = validatedMigrationFiles(input.migrationFiles);
  const manifestHashes = productionA5ManifestHashes(input.manifest);
  const riskSummary = productionA5MigrationRiskSummary(input.manifest);
  const databaseFingerprint = productionA5DatabaseFingerprint(input.snapshot);
  const profile = schemaProfileOf(input.stage, input.manifest.catalogScope, input.snapshot.schemaObjects);
  if (profile.unexpectedPresent.length > 0 || profile.unexpectedMissing.length > 0) {
    throw new Error('production_a5_schema_profile_mismatch');
  }
  const expectedSchema = input.stage === 'PRE_MUTATION'
    ? input.manifest.preSchemaCatalogObjects
    : input.manifest.postSchemaCatalogObjects;
  if (stableJson(input.snapshot.schemaObjects) !== stableJson(expectedSchema)) {
    throw new Error('production_a5_reviewed_schema_mismatch');
  }
  const applied = activeMigrationMap(input.snapshot.appliedMigrations);
  const appliedMigrationsHash = hashValue(input.snapshot.appliedMigrations);
  const repositoryByName = new Map(repositoryFiles.map((file) => [file.name, file.fileSha256]));
  for (const [name, checksum] of applied) {
    const gitChecksum = repositoryByName.get(name);
    if (gitChecksum === undefined) throw new Error('production_a5_orphan_applied_migration');
    if (gitChecksum !== checksum) throw new Error('production_a5_edited_applied_migration');
  }
  const reviewedCandidates = input.manifest.reviewedMigrationManifest
    .map((row) => ({ name: row.migrationName, checksum: row.checksumSha256 }));
  const reviewedCandidateNames = new Set(reviewedCandidates.map((row) => row.name));
  const pendingFromLive = repositoryFiles
    .filter((file) => !applied.has(file.name))
    .map((file) => ({ name: file.name, checksum: file.fileSha256 }));
  const appliedCandidateCount = reviewedCandidates.filter((row) => applied.get(row.name) === row.checksum).length;
  const candidateSetApplied = appliedCandidateCount === reviewedCandidates.length;
  if (input.stage === 'PRE_MUTATION'
    && stableJson(pendingFromLive) !== stableJson(reviewedCandidates)) {
    throw new Error('production_a5_live_pending_set_not_exactly_reviewed');
  }
  if ((input.stage === 'PRE_MUTATION' && appliedCandidateCount !== 0)
    || (input.stage !== 'PRE_MUTATION'
      && (!candidateSetApplied || pendingFromLive.length !== 0))) {
    throw new Error('production_a5_candidate_migration_stage_mismatch');
  }

  const pre = input.stage === 'PRE_MUTATION'
    ? null
    : validatedBaseline(input.preMutationBaseline, 'PRE_MUTATION');
  const postMigration = input.stage === 'POST_DEPLOYMENT'
    ? validatedBaseline(input.postMigrationBaseline, 'POST_MIGRATION')
    : null;
  if (pre && (stableJson(reimbursementWriteQuiesce.bridgeProof)
      !== stableJson(pre.payload.reimbursementWriteQuiesce.bridgeProof)
    || reimbursementWriteQuiesce.quiesceStartedAtEpoch
      !== pre.payload.reimbursementWriteQuiesce.quiesceStartedAtEpoch)) {
    throw new Error('production_a5_reimbursement_bridge_chain_mismatch');
  }
  if (postMigration && reimbursementWriteQuiesce.reimbursementInvariantHash
    !== postMigration.payload.reimbursementWriteQuiesce.reimbursementInvariantHash) {
    throw new Error('production_a5_reimbursement_invariant_chain_mismatch');
  }
  for (const baseline of [pre?.payload, postMigration?.payload].filter(Boolean) as ProductionA5Payload[]) {
    const migration = baseline.migrationState;
    for (const key of Object.keys(manifestHashes) as Array<keyof ProductionA5ManifestHashes>) {
      if (migration[key] !== manifestHashes[key]) throw new Error('production_a5_baseline_manifest_mismatch');
    }
    if (stableJson(migration.migrationRiskSummary) !== stableJson(riskSummary)) {
      throw new Error('production_a5_baseline_migration_risk_mismatch');
    }
    if (stableJson(migration.reviewedManifest) !== stableJson(input.manifest)) {
      throw new Error('production_a5_baseline_reviewed_manifest_mismatch');
    }
  }
  const verificationEvidence = parseVerificationEvidence(
    input.verificationEvidence,
    input.stage,
    input.manifest.reviewedMigrationManifest,
    manifestHashes,
    pre?.payload.migrationState.appliedMigrationsHash ?? appliedMigrationsHash,
    {
      source: hashValue(input.manifest.preSchemaCatalogObjects),
      result: hashValue(input.manifest.postSchemaCatalogObjects),
    },
  );
  if (pre && (stableJson(verificationEvidence.preconditionResults)
      !== stableJson(pre.payload.migrationState.verificationEvidence.preconditionResults)
    || stableJson(verificationEvidence.cloneRehearsal)
      !== stableJson(pre.payload.migrationState.verificationEvidence.cloneRehearsal))) {
    throw new Error('production_a5_preflight_or_clone_rehearsal_chain_mismatch');
  }
  if (postMigration && stableJson(verificationEvidence)
    !== stableJson(postMigration.payload.migrationState.verificationEvidence)) {
    throw new Error('production_a5_post_verification_evidence_drift');
  }
  if (input.stage !== 'PRE_MUTATION') {
    const appliedByName = new Map(input.snapshot.appliedMigrations.map((row) => [row.name, row]));
    const actualExecuted = input.manifest.reviewedMigrationManifest.map((row) => {
      const appliedRow = appliedByName.get(row.migrationName);
      if (!appliedRow) throw new Error('production_a5_executed_migration_missing_from_database');
      return {
        relativePath: row.relativePath,
        migrationName: row.migrationName,
        checksumSha256: appliedRow.checksum,
        executionOrder: appliedRow.appliedOrder,
      };
    });
    if (verificationEvidence.executedMigrations.status !== 'VERIFIED'
      || stableJson(verificationEvidence.executedMigrations.migrations) !== stableJson(actualExecuted)) {
      throw new Error('production_a5_executed_migration_database_evidence_mismatch');
    }
  }
  if (pre) {
    const unchangedBaselineMigrations = input.snapshot.appliedMigrations
      .filter((row) => !reviewedCandidateNames.has(row.name));
    if (hashValue(unchangedBaselineMigrations) !== pre.payload.migrationState.appliedMigrationsHash) {
      throw new Error('production_a5_unreviewed_migration_drift');
    }
    if (profile.scopeHash !== pre.payload.schemaProfile.scopeHash) {
      throw new Error('production_a5_schema_catalog_scope_drift');
    }
  }
  if (postMigration && pre) {
    const preAuthority = pre.payload.authoritySnapshot;
    const postAuthority = postMigration.payload.authoritySnapshot;
    const preservedKeys = [
      'preexistingEntitlementStateHash', 'preexistingAuthorityStateHash', 'effectiveOpenPolicyHash',
      'safeOffAdmissionHash', 'allowListHash',
    ] as const;
    if (stableJson(postMigration.payload.baselineRefs.preMutationRef) !== stableJson(pre.ref)
      || stableJson(postMigration.payload.servingBuilds) !== stableJson(pre.payload.servingBuilds)
      || postMigration.payload.schemaProfile.scopeHash !== pre.payload.schemaProfile.scopeHash
      || stableJson(postMigration.payload.schemaFingerprintScope)
        !== stableJson(pre.payload.schemaFingerprintScope)
      || preservedKeys.some((key) => postAuthority[key] !== preAuthority[key])) {
      throw new Error('production_a5_post_migration_baseline_chain_invalid');
    }
  }

  const authority = input.snapshot;
  const commonComparisons = pre ? {
    preexistingEntitlementsUnchanged: authority.preexistingEntitlementStateHash
      === pre.payload.authoritySnapshot.preexistingEntitlementStateHash,
    preexistingAuthorityUnchanged: authority.preexistingAuthorityStateHash
      === pre.payload.authoritySnapshot.preexistingAuthorityStateHash,
    effectiveOpenPolicyUnchanged: authority.effectiveOpenPolicyHash
      === pre.payload.authoritySnapshot.effectiveOpenPolicyHash,
    safeOffAdmissionsUnchanged: authority.safeOffAdmissionHash
      === pre.payload.authoritySnapshot.safeOffAdmissionHash,
    allowListUnchanged: authority.allowListHash === pre.payload.authoritySnapshot.allowListHash,
  } : null;
  if (commonComparisons && Object.values(commonComparisons).some((value) => !value)) {
    throw new Error('production_a5_preexisting_authority_drift');
  }

  let launchCatalog: LaunchCatalogPayload = {
    status: 'NOT_MATERIALIZED', materialized: 0, expectedAfterMigration: 20, unexpected: 0,
  };
  let whtMaterialization: WhtMaterializationPayload = {
    status: 'NOT_MATERIALIZED',
    actualCounts: null,
    actualRoutes: [],
    reviewedExpectedCounts: { total: 3, open: 0, closed: 3 },
    reviewedExpectedRoutes: [...input.manifest.expectedClosedWhtRoutes],
  };
  let exactReviewedSeedMaterialized: boolean | null = null;
  let closedWhtMaterialized: boolean | null = null;
  if (input.stage !== 'PRE_MUTATION') {
    if (!input.snapshot.launch || input.snapshot.normalization.status !== 'MATERIALIZED') {
      throw new Error('production_a5_materialized_state_missing');
    }
    for (const [index, row] of input.snapshot.launch.routes.entries()) {
      if ((row.state !== 'OPEN' && row.state !== 'CLOSED') || !Number.isSafeInteger(row.generation)
        || row.generation < 0 || row.gateKey === '' || row.routeKey === '') {
        throw new Error(`production_a5_launch_route_${index}_invalid`);
      }
    }
    assertSortedUnique(
      input.snapshot.launch.routes,
      (row) => `${row.gateKey}\0${row.routeKey}`,
      'production_a5_launch_routes',
    );
    if (input.snapshot.launch.featureLaunchStateHash !== hashValue(input.snapshot.launch.routes)) {
      throw new Error('production_a5_launch_state_hash_invalid');
    }
    const routes = actualRoutes(input.snapshot.launch);
    exactReviewedSeedMaterialized = hashValue(routes) === manifestHashes.expectedSeededRouteHash;
    const whtRoutes = routes.filter((row) => row.gateKey === 'cap.wht50bis');
    closedWhtMaterialized = hashValue(whtRoutes) === manifestHashes.expectedClosedWhtRouteHash;
    const expectedKeys = new Set(input.manifest.expectedSeededRoutes.map((row) => `${row.gateKey}\0${row.routeKey}`));
    const unexpected = routes.filter((row) => !expectedKeys.has(`${row.gateKey}\0${row.routeKey}`)).length;
    if (!exactReviewedSeedMaterialized || !closedWhtMaterialized || routes.length !== 20 || unexpected !== 0
      || input.snapshot.normalization.incomplete !== 0 || input.snapshot.normalization.drift !== 0
      || input.snapshot.normalization.unexpectedOrigin !== 0) {
      throw new Error('production_a5_materialized_state_not_clean');
    }
    launchCatalog = { status: 'MATERIALIZED', materialized: 20, expectedAfterMigration: 20, unexpected: 0 };
    whtMaterialization = {
      status: 'MATERIALIZED',
      actualCounts: { total: 3, open: 0, closed: 3 },
      actualRoutes: whtRoutes,
      reviewedExpectedCounts: { total: 3, open: 0, closed: 3 },
      reviewedExpectedRoutes: [...input.manifest.expectedClosedWhtRoutes],
    };
  }

  if (input.stage === 'POST_MIGRATION'
    && stableJson(servingBuilds) !== stableJson(pre!.payload.servingBuilds)) {
    throw new Error('production_a5_post_migration_serving_build_drift');
  }
  if (input.stage === 'POST_DEPLOYMENT'
    && servingBuilds.some((row) => row.sourceCommit !== input.sourceCommit)) {
    throw new Error('production_a5_post_deployment_serving_build_mismatch');
  }
  const postMigrationLaunchStateUnchanged = input.stage === 'POST_DEPLOYMENT'
    ? input.snapshot.launch?.featureLaunchStateHash
      === postMigration!.payload.authoritySnapshot.featureLaunchStateHash
    : null;
  if (postMigrationLaunchStateUnchanged === false) throw new Error('production_a5_launch_state_drift');

  const comparisons: ProductionA5Payload['comparisons'] = input.stage === 'PRE_MUTATION' ? {
    preexistingEntitlementsUnchanged: null,
    preexistingAuthorityUnchanged: null,
    effectiveOpenPolicyUnchanged: null,
    safeOffAdmissionsUnchanged: null,
    allowListUnchanged: null,
    exactReviewedMigrationSetApplied: null,
    exactExpectedSchemaDeltaMaterialized: null,
    exactExpectedDataTransformsVerified: null,
    allPreflightConditionsSatisfied: null,
    lockBudgetSatisfied: null,
    exactReviewedSeedMaterialized: null,
    closedWhtMaterialized: null,
    postMigrationLaunchStateUnchanged: null,
  } : {
    ...commonComparisons!,
    exactReviewedMigrationSetApplied: true,
    exactExpectedSchemaDeltaMaterialized: true,
    exactExpectedDataTransformsVerified: true,
    allPreflightConditionsSatisfied: true,
    lockBudgetSatisfied: true,
    exactReviewedSeedMaterialized,
    closedWhtMaterialized,
    postMigrationLaunchStateUnchanged,
  };
  const featureLaunchStateHash = input.snapshot.launch?.featureLaunchStateHash ?? null;
  const payload: ProductionA5Payload = {
    stage: input.stage,
    targetEnvironment: 'production',
    readerBoundary: input.snapshot.readerBoundary,
    queryCatalogHash: PRODUCTION_A5_QUERY_CATALOG_HASH,
    databaseFingerprint,
    schemaProfile: profile,
    schemaFingerprintScope: PRODUCTION_A5_SCHEMA_FINGERPRINT_SCOPE,
    migrationState: {
      appliedMigrationsHash,
      ...manifestHashes,
      reviewedManifest: input.manifest,
      migrationRiskSummary: riskSummary,
      candidateSetApplied,
      verificationEvidence,
    },
    servingBuilds,
    reimbursementWriteQuiesce,
    reimbursementApprovalSnapshots,
    authoritySnapshot: {
      preexistingEntitlementStateHash: authority.preexistingEntitlementStateHash,
      preexistingAuthorityStateHash: authority.preexistingAuthorityStateHash,
      effectiveOpenPolicyHash: authority.effectiveOpenPolicyHash,
      safeOffAdmissionHash: authority.safeOffAdmissionHash,
      allowListHash: authority.allowListHash,
      featureLaunchStateHash,
      launchCatalog,
      whtMaterialization,
    },
    normalization: input.snapshot.normalization,
    baselineRefs: {
      preMutationRef: pre?.ref ?? null,
      postMigrationRef: postMigration?.ref ?? null,
    },
    comparisons,
    passed: true,
  };
  assertProductionA5StageInvariant(payload);
  return payload;
}
