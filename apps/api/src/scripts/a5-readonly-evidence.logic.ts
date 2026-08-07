import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Prisma, PrismaClient } from '../generated/prisma/client';
import type { PrismaService } from '../common/database/prisma.service';
import {
  GetLaunchHealthUseCase,
  type LaunchHealthView,
} from '../modules/feature-launch/application/use-cases/get-launch-health.use-case';
import { MATERIALIZABLE_LAUNCH_MATRIX_ROWS } from '../modules/feature-launch/domain/launch-matrix.catalog';
import { NORMALIZER_VERSION } from '../modules/employee-access/application/normalize-entitlements';

export const A5_READER_ROLE = 'watchdog_a5_ro';
export const A5_PRODUCTION_READER_ROLE = 'watchdog_a5_prod_ro';
export type A5TargetEnvironment = 'uat' | 'production';
export type A5SchemaProfile = 'LEGACY_PRE_F1' | 'F1_CURRENT';

const A5_READER_ROLES = new Set([A5_READER_ROLE, A5_PRODUCTION_READER_ROLE]);

export function a5ReaderRoleForEnvironment(environment: A5TargetEnvironment): string {
  return environment === 'production' ? A5_PRODUCTION_READER_ROLE : A5_READER_ROLE;
}

function environmentValue(name: string, value: string | undefined): A5TargetEnvironment | undefined {
  if (value === undefined || value === '') return undefined;
  if (value !== 'uat' && value !== 'production') {
    throw new Error(`${name} must be uat or production`);
  }
  return value;
}

/** Resolve the database target without allowing APP_ENV or one selector to mask another. */
export function resolveA5TargetEnvironment(
  env: Readonly<Record<string, string | undefined>>,
): A5TargetEnvironment {
  const deployEnvironment = environmentValue('DEPLOY_ENVIRONMENT', env['DEPLOY_ENVIRONMENT']);
  const deployEnv = environmentValue('DEPLOY_ENV', env['DEPLOY_ENV']);
  if (deployEnvironment && deployEnv && deployEnvironment !== deployEnv) {
    throw new Error('DEPLOY_ENVIRONMENT and DEPLOY_ENV must match');
  }
  const deploymentTarget = deployEnvironment ?? deployEnv;
  if (!deploymentTarget) throw new Error('DEPLOY_ENVIRONMENT or DEPLOY_ENV is required');

  const explicitTarget = environmentValue('A5_TARGET_ENVIRONMENT', env['A5_TARGET_ENVIRONMENT']);
  if (explicitTarget && explicitTarget !== deploymentTarget) {
    throw new Error('A5_TARGET_ENVIRONMENT must match the deployment environment');
  }
  if (deploymentTarget === 'production' && explicitTarget !== 'production') {
    throw new Error('production A5 bootstrap requires explicit A5_TARGET_ENVIRONMENT=production');
  }
  return explicitTarget ?? deploymentTarget;
}

function schemaProfileValue(value: string | undefined): A5SchemaProfile | undefined {
  if (value === undefined || value === '') return undefined;
  if (value !== 'LEGACY_PRE_F1' && value !== 'F1_CURRENT') {
    throw new Error('A5_SCHEMA_PROFILE must be LEGACY_PRE_F1 or F1_CURRENT');
  }
  return value;
}

export function resolveA5SchemaProfile(
  env: Readonly<Record<string, string | undefined>>,
  targetEnvironment: A5TargetEnvironment,
): A5SchemaProfile {
  const explicitProfile = schemaProfileValue(env['A5_SCHEMA_PROFILE']);
  if (targetEnvironment === 'production') {
    if (!explicitProfile) throw new Error('production A5 bootstrap requires explicit A5_SCHEMA_PROFILE');
    return explicitProfile;
  }
  if (explicitProfile === 'LEGACY_PRE_F1') {
    throw new Error('UAT A5 bootstrap requires the F1_CURRENT schema profile');
  }
  return 'F1_CURRENT';
}
export const A5_CORE_TABLES = [
  '_prisma_migrations',
  'Company',
  'CompanyFeatureEntitlement',
  'CompanyEntitlementNormalization',
  'EntitlementTransition',
  'AuditLog',
  'CompanyOnboardingRun',
  'FeatureLaunchGate',
  'FeatureLaunchGateTransition',
  'FeatureLaunchObservationBucket',
  'ExecutionAttempt',
  'RunoffSnapshot',
  'WorkflowTask',
] as const;

/** Production H2 reads only these two extra tables to classify pending approval snapshots. */
export const A5_PRODUCTION_REIMBURSEMENT_TABLES = [
  'ReimbursementRequest',
  'ReimbursementLine',
] as const;

export const A5_LEGACY_PRE_F1_MISSING_CORE_TABLES = [
  'CompanyEntitlementNormalization',
  'EntitlementTransition',
  'FeatureLaunchGate',
  'FeatureLaunchGateTransition',
  'FeatureLaunchObservationBucket',
  'ExecutionAttempt',
  'RunoffSnapshot',
] as const;

export function a5EvidenceTableCatalog(targetEnvironment: A5TargetEnvironment): string[] {
  return targetEnvironment === 'production'
    ? [...A5_CORE_TABLES, ...A5_PRODUCTION_REIMBURSEMENT_TABLES]
    : [...A5_CORE_TABLES];
}

export function validateA5CoreTableCatalog(
  profile: A5SchemaProfile,
  presentCoreTables: readonly string[],
  targetEnvironment: A5TargetEnvironment = 'uat',
): string[] {
  const catalog = a5EvidenceTableCatalog(targetEnvironment);
  const core = new Set<string>(catalog);
  const present = new Set(presentCoreTables);
  if (present.size !== presentCoreTables.length || presentCoreTables.some((table) => !core.has(table))) {
    throw new Error('A5 schema inspection returned an invalid core relation catalog');
  }
  const missing = catalog.filter((table) => !present.has(table));
  const expectedMissing = profile === 'LEGACY_PRE_F1'
    ? [
      ...A5_LEGACY_PRE_F1_MISSING_CORE_TABLES,
      ...(targetEnvironment === 'production' ? ['ReimbursementLine'] : []),
    ]
    : [];
  if (missing.length !== expectedMissing.length
    || missing.some((table, index) => table !== expectedMissing[index])) {
    throw new Error(
      `A5 ${profile} schema profile mismatch (missing=${missing.join(',') || 'none'}; expected=${expectedMissing.join(',') || 'none'})`,
    );
  }
  return catalog.filter((table) => present.has(table));
}

/**
 * Semantic identity of the fixed query set. The artifact also binds the exact source commit/image,
 * so implementation bytes cannot change underneath this catalog between PLAN and APPLY.
 */
export const A5_QUERY_CATALOG = {
  coreTables: [...A5_CORE_TABLES],
  productionReimbursementTables: [...A5_PRODUCTION_REIMBURSEMENT_TABLES],
  normalizerVersion: NORMALIZER_VERSION,
  launchMatrixRows: MATERIALIZABLE_LAUNCH_MATRIX_ROWS.map((row) => `${row.gateKey}:${row.routeKey}`),
  readerGuard: `
    SELECT current_user, current_setting('transaction_read_only'),
           current_setting('default_transaction_read_only')`,
  tablePrivileges: 'all non-system schemas including column ACLs: exact core SELECT, no outside SELECT/DML/MAINTAIN/sequence authority or core RLS',
  functionPrivileges: 'no executable SECURITY DEFINER routine in any non-system schema',
  ownership: 'zero owner dependencies for watchdog_a5_ro in pg_shdepend',
  migrations: `SELECT migration_name, checksum, finished_at, rolled_back_at
                 FROM "_prisma_migrations" ORDER BY started_at, id`,
  companyCoverage: 'aggregate Company LEFT JOIN CompanyEntitlementNormalization and entitlement existence',
  entitlementCounts: 'aggregate CompanyFeatureEntitlement by featureKey and enabled',
  normalizationCounts: 'aggregate CompanyEntitlementNormalization by status, cohortKind and version',
  cohortEvidence: 'aggregate completed CompanyOnboardingRun, human EntitlementTransition and LEGACY normalize AuditLog',
  launchHealth: 'GetLaunchHealthUseCase.execute tenant-free evidence tracks + observedRoutes v2',
  launchCatalog: 'actual FeatureLaunchGate rows reconciled to catalog and max FeatureLaunchGateTransition seq',
  workflowTaskDuplicates: 'aggregate WorkflowTask duplicate deterministic source tuples without returning tuple values',
} as const;

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

function canonicalValue(value: unknown): JsonValue {
  if (value === null) return null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('A5 evidence cannot hash a non-finite number');
    return value;
  }
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        // Code-point order matches `jq --sort-keys`, which the GitHub controller uses to
        // independently recompute the artifact hash before it can authorize F2.
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, item]) => [key, canonicalValue(item)]),
    );
  }
  throw new Error(`A5 evidence cannot hash ${typeof value}`);
}

export function stableJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

export function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export const A5_QUERY_CATALOG_HASH = sha256(stableJson(A5_QUERY_CATALOG));

/** generatedAt is provenance, not estate state; rerunning the same reviewed state yields one hash. */
export function a5EvidenceHash(value: Record<string, unknown>): string {
  const { generatedAt: _generatedAt, evidenceHash: _evidenceHash, ...deterministic } = value;
  return sha256(stableJson(deterministic));
}

export type LocalMigration = { name: string; checksum: string };
export type DatabaseMigration = {
  name: string;
  checksum: string;
  finishedAt: Date | string | null;
  rolledBackAt: Date | string | null;
};

export type MigrationDrift = {
  localCount: number;
  appliedCount: number;
  missingInDatabase: string[];
  unknownInDatabase: string[];
  checksumMismatches: string[];
  unfinished: string[];
  duplicateAppliedNames: string[];
  clean: boolean;
};

export function readLocalMigrations(directory: string): LocalMigration[] {
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      checksum: sha256(readFileSync(join(directory, entry.name, 'migration.sql'))),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function compareMigrations(
  local: readonly LocalMigration[],
  database: readonly DatabaseMigration[],
): MigrationDrift {
  const applied = database.filter((row) => row.finishedAt !== null && row.rolledBackAt === null);
  const unfinished = database
    .filter((row) => row.finishedAt === null && row.rolledBackAt === null)
    .map((row) => row.name)
    .sort();
  const appliedCounts = new Map<string, number>();
  for (const row of applied) appliedCounts.set(row.name, (appliedCounts.get(row.name) ?? 0) + 1);
  const duplicateAppliedNames = [...appliedCounts]
    .filter(([, count]) => count > 1)
    .map(([name]) => name)
    .sort();
  const localByName = new Map(local.map((row) => [row.name, row]));
  const appliedByName = new Map(applied.map((row) => [row.name, row]));
  const missingInDatabase = local.filter((row) => !appliedByName.has(row.name)).map((row) => row.name).sort();
  const unknownInDatabase = applied.filter((row) => !localByName.has(row.name)).map((row) => row.name).sort();
  const checksumMismatches = local
    .filter((row) => {
      const stored = appliedByName.get(row.name)?.checksum;
      return stored !== undefined && stored !== row.checksum;
    })
    .map((row) => row.name)
    .sort();
  const clean = missingInDatabase.length === 0
    && unknownInDatabase.length === 0
    && checksumMismatches.length === 0
    && unfinished.length === 0
    && duplicateAppliedNames.length === 0;
  return {
    localCount: local.length,
    appliedCount: applied.length,
    missingInDatabase,
    unknownInDatabase,
    checksumMismatches,
    unfinished,
    duplicateAppliedNames,
    clean,
  };
}

export type ReaderGuard = {
  currentUser: string;
  transactionReadOnly: boolean;
  defaultTransactionReadOnly: boolean;
  roleNoInherit: boolean;
  roleNonPrivileged: boolean;
  roleMemberships: number;
  missingCoreSelect: number;
  outsideCoreSelect: number;
  dmlPrivilegeTables: number;
  sequencePrivilegeObjects: number;
  securityDefinerExecute: number;
  ownedObjects: number;
  rowSecurityCoreTables: number;
  databaseCreate: boolean;
  schemaCreate: boolean;
};

export function readerGuardBlockers(
  guard: ReaderGuard,
  expectedReaderRole: string = A5_READER_ROLE,
): string[] {
  const blockers: string[] = [];
  if (guard.currentUser !== expectedReaderRole) blockers.push('reader_role_mismatch');
  if (!guard.transactionReadOnly) blockers.push('transaction_not_read_only');
  if (!guard.defaultTransactionReadOnly) blockers.push('default_not_read_only');
  if (!guard.roleNoInherit) blockers.push('reader_role_inherits');
  if (!guard.roleNonPrivileged) blockers.push('reader_role_has_cluster_privilege');
  if (guard.roleMemberships !== 0) blockers.push('reader_role_has_memberships');
  if (guard.missingCoreSelect !== 0) blockers.push('core_select_missing');
  if (guard.outsideCoreSelect !== 0) blockers.push('forbidden_table_select');
  if (guard.dmlPrivilegeTables !== 0) blockers.push('dml_privilege_present');
  if (guard.sequencePrivilegeObjects !== 0) blockers.push('sequence_privilege_present');
  if (guard.securityDefinerExecute !== 0) blockers.push('security_definer_execute_present');
  if (guard.ownedObjects !== 0) blockers.push('reader_role_owns_objects');
  if (guard.rowSecurityCoreTables !== 0) blockers.push('core_table_row_security_present');
  if (guard.databaseCreate) blockers.push('database_create_privilege_present');
  if (guard.schemaCreate) blockers.push('schema_create_privilege_present');
  return blockers;
}

export function decideF2Precheck(input: {
  guard: ReaderGuard;
  migrationsClean: boolean;
  launchCatalogClean: boolean;
  whtOpenRoutes: number;
}): { ready: boolean; blockers: string[] } {
  const blockers = [
    ...readerGuardBlockers(input.guard),
    ...(!input.migrationsClean ? ['migration_drift'] : []),
    ...(!input.launchCatalogClean ? ['launch_catalog_drift'] : []),
    ...(input.whtOpenRoutes > 0 ? ['wht_route_open'] : []),
  ].sort();
  return { ready: blockers.length === 0, blockers };
}

export type A5ConnectionPair = {
  writerUrl: string;
  readerUrl: string;
  targetEnvironment: A5TargetEnvironment;
  writerRole: string;
  readerRole: string;
  host: string;
  port: string;
  database: string;
  schema: string;
  readerPassword: string;
};

function connectionIdentity(url: URL) {
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new Error('A5 database URL must use postgres or postgresql');
  }
  // node-postgres lets query parameters such as `host`, `user`, `password`, `port`, and
  // `options=-c role=...` override the URI authority/session. Reject those aliases so the
  // identity reviewed below is the identity that will actually connect.
  const identityOverrides = new Set([
    'database', 'dbname', 'host', 'hostaddr', 'options', 'passfile', 'password',
    'port', 'service', 'servicefile', 'user', 'username',
  ]);
  for (const key of url.searchParams.keys()) {
    if (identityOverrides.has(key.toLowerCase())) {
      throw new Error('A5 database URL must not override connection identity in query parameters');
    }
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  const schema = url.searchParams.get('schema') ?? 'public';
  const host = url.hostname.toLowerCase();
  const username = decodeURIComponent(url.username);
  if (host === '' || database === '' || schema === '' || schema.includes('\0') || username === '') {
    throw new Error('A5 database URL identity is incomplete');
  }
  return {
    host,
    port: url.port || '5432',
    database,
    schema,
    username,
    password: decodeURIComponent(url.password),
  };
}

export function validateA5ConnectionPair(
  writerUrl: string,
  readerUrl: string,
  targetEnvironment: string,
): A5ConnectionPair {
  const environment = environmentValue('A5 target environment', targetEnvironment);
  if (!environment) throw new Error('A5 target environment is required');
  const readerRole = a5ReaderRoleForEnvironment(environment);
  const writer = connectionIdentity(new URL(writerUrl));
  const reader = connectionIdentity(new URL(readerUrl));
  if (reader.username !== readerRole) throw new Error(`A5 reader URL must use ${readerRole}`);
  if (A5_READER_ROLES.has(writer.username) || writer.username === reader.username) {
    throw new Error('A5 writer URL must use a separate non-reader principal');
  }
  if (reader.password === '') throw new Error('A5 reader URL must carry the rotated password');
  if (writer.host !== reader.host || writer.port !== reader.port
    || writer.database !== reader.database || writer.schema !== reader.schema) {
    throw new Error('A5 writer and reader URLs must name the same host, port, database and schema');
  }
  return {
    writerUrl,
    readerUrl,
    targetEnvironment: environment,
    writerRole: writer.username,
    readerRole,
    host: writer.host,
    port: writer.port,
    database: writer.database,
    schema: writer.schema,
    readerPassword: reader.password,
  };
}

export type LaunchHealthSummary = {
  gates: { total: number; open: number; closed: number; blockedMatrixRows: number };
  wht50Bis: { total: number; open: number; closed: number };
  featureLifecycle: LaunchHealthView['featureLifecycle'];
  attempts: Record<string, number>;
  shadowWindow: LaunchHealthView['shadowWindow'];
  evidenceTracks: LaunchHealthView['evidenceTracks'];
  unmaterializedMatrixRows: number;
};

export type LaunchCatalogEvidence = {
  expectedCount: number;
  actualCount: number;
  missingRows: string[];
  extraRows: string[];
  lastSeqMismatches: string[];
  orphanTransitionRows: string[];
  clean: boolean;
};

type LaunchCatalogRow = {
  gateKey: string;
  routeKey: string;
  gateExists: boolean;
  lastSeq: number | null;
  maxTransitionSeq: number;
};

export function compareLaunchCatalog(rows: readonly LaunchCatalogRow[]): LaunchCatalogEvidence {
  const keyOf = (row: { gateKey: string; routeKey: string }) => `${row.gateKey}:${row.routeKey}`;
  const expected = new Set(MATERIALIZABLE_LAUNCH_MATRIX_ROWS.map(keyOf));
  const actual = new Set(rows.filter((row) => row.gateExists).map(keyOf));
  const missingRows = [...expected].filter((key) => !actual.has(key)).sort();
  const extraRows = [...actual].filter((key) => !expected.has(key)).sort();
  const lastSeqMismatches = rows
    .filter((row) => row.gateExists && row.lastSeq !== row.maxTransitionSeq)
    .map(keyOf)
    .sort();
  const orphanTransitionRows = rows.filter((row) => !row.gateExists).map(keyOf).sort();
  const clean = missingRows.length === 0 && extraRows.length === 0
    && lastSeqMismatches.length === 0 && orphanTransitionRows.length === 0;
  return {
    expectedCount: expected.size,
    actualCount: actual.size,
    missingRows,
    extraRows,
    lastSeqMismatches,
    orphanTransitionRows,
    clean,
  };
}

export function summarizeLaunchHealth(view: LaunchHealthView): LaunchHealthSummary {
  const wht = view.gates.filter((gate) => gate.gateKey === 'cap.wht50bis');
  const observedRoutes = [...view.shadowWindow.observedRoutes].sort((left, right) => {
    if (left.gateKey !== right.gateKey) return left.gateKey < right.gateKey ? -1 : 1;
    return left.routeKey < right.routeKey ? -1 : left.routeKey > right.routeKey ? 1 : 0;
  });
  return {
    gates: {
      total: view.gates.length,
      open: view.gates.filter((gate) => gate.state === 'OPEN').length,
      closed: view.gates.filter((gate) => gate.state === 'CLOSED').length,
      blockedMatrixRows: view.gates.filter((gate) => gate.matrixRowStatus === 'BLOCKED').length,
    },
    wht50Bis: {
      total: wht.length,
      open: wht.filter((gate) => gate.state === 'OPEN').length,
      closed: wht.filter((gate) => gate.state === 'CLOSED').length,
    },
    featureLifecycle: view.featureLifecycle,
    attempts: Object.fromEntries(Object.entries(view.attempts).sort(([a], [b]) => a.localeCompare(b))),
    shadowWindow: { ...view.shadowWindow, observedRoutes },
    evidenceTracks: view.evidenceTracks,
    unmaterializedMatrixRows: view.unmaterializedMatrixRows.length,
  };
}

type CountRow = Record<string, unknown>;

const numberOf = (value: unknown): number => {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) throw new Error(`A5 count is not a safe non-negative integer: ${String(value)}`);
  return result;
};

function boolSetting(value: unknown): boolean {
  return value === true || value === 'on';
}

function rowsToCounts(rows: CountRow[]): Array<Record<string, string | number | boolean | null>> {
  return rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => {
    if (typeof value === 'bigint') return [key, numberOf(value)];
    if (value instanceof Date) return [key, value.toISOString()];
    return [key, value as string | number | boolean | null];
  })));
}

export type A5ReadonlyEvidence = {
  artifact: 'a5-readonly-evidence';
  schemaVersion: 1;
  generatedAt: string;
  targetEnvironment: 'uat';
  sourceCommit: string;
  readOnly: true;
  queryCatalogHash: string;
  readerGuard: ReaderGuard;
  migrations: MigrationDrift;
  estate: {
    companyCoverage: Record<string, number>;
    entitlementByFeature: Array<Record<string, string | number | boolean | null>>;
    normalizationByState: Array<Record<string, string | number | boolean | null>>;
    cohortEvidence: Record<string, number>;
  };
  launchHealth: LaunchHealthSummary;
  launchCatalog: LaunchCatalogEvidence;
  workflowTaskDuplicates: Record<string, number>;
  f2PrecheckReady: boolean;
  f2PrecheckBlockers: string[];
  advisories: string[];
  evidenceHash: string;
};

type ReadTransaction = Prisma.TransactionClient;

export async function inspectA5ReaderGuard(
  tx: ReadTransaction,
  schema: string,
  expectedCoreTables: readonly string[] = A5_CORE_TABLES,
): Promise<ReaderGuard> {
  const [identity] = await tx.$queryRawUnsafe<CountRow[]>(`
    SELECT current_user AS "currentUser",
           current_setting('transaction_read_only') AS "transactionReadOnly",
           current_setting('default_transaction_read_only') AS "defaultTransactionReadOnly",
           NOT r.rolinherit AS "roleNoInherit",
           NOT (r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls)
             AS "roleNonPrivileged",
           (SELECT COUNT(*)::int FROM pg_auth_members m WHERE m.member = r.oid) AS "roleMemberships"
      FROM pg_roles r
     WHERE r.rolname = current_user
  `);
  if (!identity) throw new Error('A5 reader role is absent from pg_roles');
  const [privileges] = await tx.$queryRawUnsafe<CountRow[]>(`
    WITH app_relations AS (
      SELECT n.nspname AS schema_name, c.relname AS relation_name, c.relkind, c.relrowsecurity
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
         AND n.nspname NOT LIKE 'pg_toast%'
         AND n.nspname NOT LIKE 'pg_temp_%'
         AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
    ), core(table_name) AS (SELECT UNNEST($2::text[]))
    SELECT
      (SELECT COUNT(*)::int FROM core c
        WHERE NOT has_table_privilege(current_user, format('%I.%I', $1::text, c.table_name), 'SELECT'))
        AS "missingCoreSelect",
      COUNT(*) FILTER (WHERE a.relkind <> 'S'
        AND NOT (a.schema_name = $1::text AND a.relation_name = ANY($2::text[]))
        AND (has_table_privilege(current_user, format('%I.%I', a.schema_name, a.relation_name), 'SELECT')
          OR has_any_column_privilege(current_user, format('%I.%I', a.schema_name, a.relation_name), 'SELECT')))::int
        AS "outsideCoreSelect",
      COUNT(*) FILTER (WHERE a.relkind <> 'S'
        AND (has_table_privilege(current_user, format('%I.%I', a.schema_name, a.relation_name),
          'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
          OR has_any_column_privilege(current_user, format('%I.%I', a.schema_name, a.relation_name),
            'INSERT,UPDATE,REFERENCES')))::int AS "dmlPrivilegeTables",
      COUNT(*) FILTER (WHERE a.relkind = 'S'
        AND has_sequence_privilege(current_user, format('%I.%I', a.schema_name, a.relation_name),
          'SELECT,USAGE,UPDATE'))::int AS "sequencePrivilegeObjects",
      (SELECT COUNT(*)::int
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
          AND n.nspname NOT LIKE 'pg_toast%'
          AND n.nspname NOT LIKE 'pg_temp_%'
          AND p.prosecdef
          AND has_function_privilege(current_user, p.oid, 'EXECUTE')) AS "securityDefinerExecute",
      (SELECT COUNT(*)::int
         FROM pg_shdepend d
         JOIN pg_roles r ON r.oid = d.refobjid
        WHERE d.refclassid = 'pg_authid'::regclass
          AND d.deptype = 'o'
          AND r.rolname = current_user) AS "ownedObjects",
      COUNT(*) FILTER (WHERE a.schema_name = $1::text
        AND a.relation_name = ANY($2::text[])
        AND a.relrowsecurity)::int AS "rowSecurityCoreTables",
      has_database_privilege(current_user, current_database(), 'CREATE') AS "databaseCreate",
      EXISTS (
        SELECT 1 FROM pg_namespace n
         WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
           AND n.nspname NOT LIKE 'pg_toast%'
           AND n.nspname NOT LIKE 'pg_temp_%'
           AND has_schema_privilege(current_user, n.oid, 'CREATE')
      ) AS "schemaCreate"
      FROM app_relations a
  `, schema, [...expectedCoreTables]);
  if (!privileges) throw new Error('A5 table privilege query returned no row');
  return {
    currentUser: String(identity['currentUser']),
    transactionReadOnly: boolSetting(identity['transactionReadOnly']),
    defaultTransactionReadOnly: boolSetting(identity['defaultTransactionReadOnly']),
    roleNoInherit: identity['roleNoInherit'] === true,
    roleNonPrivileged: identity['roleNonPrivileged'] === true,
    roleMemberships: numberOf(identity['roleMemberships']),
    missingCoreSelect: numberOf(privileges['missingCoreSelect']),
    outsideCoreSelect: numberOf(privileges['outsideCoreSelect']),
    dmlPrivilegeTables: numberOf(privileges['dmlPrivilegeTables']),
    sequencePrivilegeObjects: numberOf(privileges['sequencePrivilegeObjects']),
    securityDefinerExecute: numberOf(privileges['securityDefinerExecute']),
    ownedObjects: numberOf(privileges['ownedObjects']),
    rowSecurityCoreTables: numberOf(privileges['rowSecurityCoreTables']),
    databaseCreate: privileges['databaseCreate'] === true,
    schemaCreate: privileges['schemaCreate'] === true,
  };
}

async function estateEvidence(tx: ReadTransaction) {
  const [companyCoverage] = await tx.$queryRawUnsafe<CountRow[]>(`
    SELECT COUNT(*)::int AS "companies",
           COUNT(*) FILTER (WHERE NOT EXISTS (
             SELECT 1 FROM "CompanyFeatureEntitlement" e WHERE e."companyId" = c."id"
           ))::int AS "withoutEntitlementRows",
           COUNT(*) FILTER (WHERE n."id" IS NULL)::int AS "withoutNormalization",
           COUNT(*) FILTER (WHERE n."id" IS NULL OR n."status" <> 'COMPLETED'
             OR n."normalizerVersion" < $1 OR n."cohortKind" IS NULL
             OR n."cohortKind" NOT IN ('LEGACY', 'EXPLICIT'))::int AS "normalizationIncomplete",
           COUNT(*) FILTER (WHERE n."cohortKind" IS NOT NULL
             AND n."cohortKind" NOT IN ('LEGACY', 'EXPLICIT'))::int AS "invalidCohort"
      FROM "Company" c
      LEFT JOIN "CompanyEntitlementNormalization" n ON n."companyId" = c."id"
  `, NORMALIZER_VERSION);
  if (!companyCoverage) throw new Error('A5 company coverage query returned no row');
  const entitlementByFeature = await tx.$queryRawUnsafe<CountRow[]>(`
    SELECT "featureKey", "enabled", COUNT(*)::int AS "companies"
      FROM "CompanyFeatureEntitlement"
     GROUP BY "featureKey", "enabled"
     ORDER BY "featureKey", "enabled"
  `);
  const normalizationByState = await tx.$queryRawUnsafe<CountRow[]>(`
    SELECT "status", "cohortKind", "normalizerVersion", COUNT(*)::int AS "companies"
      FROM "CompanyEntitlementNormalization"
     GROUP BY "status", "cohortKind", "normalizerVersion"
     ORDER BY "status", "cohortKind" NULLS FIRST, "normalizerVersion"
  `);
  const [cohortEvidence] = await tx.$queryRawUnsafe<CountRow[]>(`
    SELECT
      (SELECT COUNT(*)::int FROM "CompanyOnboardingRun" WHERE "status" = 'COMPLETED')
        AS "completedOnboardingRuns",
      (SELECT COUNT(*)::int FROM "EntitlementTransition" WHERE "actorUserId" <> 'SYSTEM')
        AS "humanEntitlementTransitions",
      (SELECT COUNT(*)::int FROM "AuditLog" WHERE "action" = 'system.entitlement.normalize'
        AND "metadataJson"->>'grantOrigin' = 'LEGACY') AS "legacyNormalizationAudits"
  `);
  if (!cohortEvidence) throw new Error('A5 cohort evidence query returned no row');
  return {
    companyCoverage: Object.fromEntries(Object.entries(companyCoverage).map(([key, value]) => [key, numberOf(value)])),
    entitlementByFeature: rowsToCounts(entitlementByFeature),
    normalizationByState: rowsToCounts(normalizationByState),
    cohortEvidence: Object.fromEntries(Object.entries(cohortEvidence).map(([key, value]) => [key, numberOf(value)])),
  };
}

async function workflowTaskDuplicates(tx: ReadTransaction): Promise<Record<string, number>> {
  const [row] = await tx.$queryRawUnsafe<CountRow[]>(`
    SELECT COUNT(*)::int AS "duplicateGroups",
           COALESCE(SUM(d.row_count), 0)::int AS "rowsInDuplicateGroups",
           COALESCE(SUM(d.row_count - 1), 0)::int AS "excessRows"
      FROM (
        SELECT COUNT(*)::int AS row_count
          FROM "WorkflowTask"
         WHERE "sourceModule" IS NOT NULL AND "sourceType" IS NOT NULL AND "sourceId" IS NOT NULL
         GROUP BY "companyId", "sourceModule", "sourceType", "sourceId"
        HAVING COUNT(*) > 1
      ) d
  `);
  if (!row) throw new Error('A5 WorkflowTask duplicate query returned no row');
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, numberOf(value)]));
}

async function launchCatalogEvidence(tx: ReadTransaction): Promise<LaunchCatalogEvidence> {
  const rows = await tx.$queryRawUnsafe<Array<{
    gateKey: string;
    routeKey: string;
    gateExists: boolean;
    lastSeq: number | null;
    maxTransitionSeq: number;
  }>>(`
    WITH transition_max AS (
      SELECT "gateKey", "routeKey", MAX("seq")::int AS max_seq
        FROM "FeatureLaunchGateTransition"
       GROUP BY "gateKey", "routeKey"
    )
    SELECT COALESCE(g."gateKey", t."gateKey") AS "gateKey",
           COALESCE(g."routeKey", t."routeKey") AS "routeKey",
           (g."id" IS NOT NULL) AS "gateExists",
           g."lastSeq" AS "lastSeq",
           COALESCE(t.max_seq, 0)::int AS "maxTransitionSeq"
      FROM "FeatureLaunchGate" g
      FULL OUTER JOIN transition_max t
        ON t."gateKey" = g."gateKey" AND t."routeKey" = g."routeKey"
     ORDER BY 1, 2
  `);
  return compareLaunchCatalog(rows);
}

export async function collectA5ReadonlyEvidence(input: {
  prisma: PrismaClient;
  schema: string;
  migrationsDirectory: string;
  generatedAt: string;
  sourceCommit: string;
}): Promise<A5ReadonlyEvidence> {
  const localMigrations = readLocalMigrations(input.migrationsDirectory);
  return input.prisma.$transaction(async (tx) => {
    // First application statement, and independently backed by the role default checked below.
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    const guard = await inspectA5ReaderGuard(tx, input.schema);
    const migrationRows = await tx.$queryRawUnsafe<Array<{
      migration_name: string;
      checksum: string;
      finished_at: Date | null;
      rolled_back_at: Date | null;
    }>>(`
      SELECT migration_name, checksum, finished_at, rolled_back_at
        FROM "_prisma_migrations"
       ORDER BY started_at, id
    `);
    const migrations = compareMigrations(localMigrations, migrationRows.map((row) => ({
      name: row.migration_name,
      checksum: row.checksum,
      finishedAt: row.finished_at,
      rolledBackAt: row.rolled_back_at,
    })));
    const estate = await estateEvidence(tx);
    const launchHealth = summarizeLaunchHealth(await new GetLaunchHealthUseCase({
      client: tx,
    } as unknown as PrismaService).execute());
    const launchCatalog = await launchCatalogEvidence(tx);
    const duplicates = await workflowTaskDuplicates(tx);
    const f2Precheck = decideF2Precheck({
      guard,
      migrationsClean: migrations.clean,
      launchCatalogClean: launchCatalog.clean,
      whtOpenRoutes: launchHealth.wht50Bis.open,
    });
    const advisories = [
      ...(estate.companyCoverage['normalizationIncomplete'] > 0 ? ['normalization_pending_before_f2'] : []),
      ...(duplicates['duplicateGroups'] > 0 ? ['workflow_task_duplicates_present'] : []),
      ...(launchHealth.evidenceTracks.async.catalogComplete < launchHealth.evidenceTracks.async.required
        ? ['async_shadow_catalog_incomplete'] : []),
      ...(launchHealth.evidenceTracks.async.observed < launchHealth.evidenceTracks.async.required
        ? ['async_shadow_observation_incomplete'] : []),
      'capacity_mutating_evidence_not_part_of_a5_ro',
    ].sort();
    const unsigned: Omit<A5ReadonlyEvidence, 'evidenceHash'> = {
      artifact: 'a5-readonly-evidence',
      schemaVersion: 1,
      generatedAt: input.generatedAt,
      targetEnvironment: 'uat',
      sourceCommit: input.sourceCommit,
      readOnly: true,
      queryCatalogHash: A5_QUERY_CATALOG_HASH,
      readerGuard: guard,
      migrations,
      estate,
      launchHealth,
      launchCatalog,
      workflowTaskDuplicates: duplicates,
      f2PrecheckReady: f2Precheck.ready,
      f2PrecheckBlockers: f2Precheck.blockers,
      advisories,
    };
    return { ...unsigned, evidenceHash: a5EvidenceHash(unsigned) };
  }, { isolationLevel: 'RepeatableRead', maxWait: 5_000, timeout: 60_000 });
}
