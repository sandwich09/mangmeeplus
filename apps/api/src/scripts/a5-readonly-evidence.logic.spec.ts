import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { LaunchHealthView } from '../modules/feature-launch/application/use-cases/get-launch-health.use-case';
import {
  A5_QUERY_CATALOG_HASH,
  A5_CORE_TABLES,
  A5_LEGACY_PRE_F1_MISSING_CORE_TABLES,
  A5_PRODUCTION_REIMBURSEMENT_TABLES,
  a5EvidenceTableCatalog,
  A5_PRODUCTION_READER_ROLE,
  A5_READER_ROLE,
  a5EvidenceHash,
  compareLaunchCatalog,
  compareMigrations,
  decideF2Precheck,
  readerGuardBlockers,
  resolveA5SchemaProfile,
  resolveA5TargetEnvironment,
  stableJson,
  summarizeLaunchHealth,
  validateA5CoreTableCatalog,
  validateA5ConnectionPair,
} from './a5-readonly-evidence.logic.js';

describe('A5 read-only evidence', () => {
  it('validates the existing UAT same-database writer/reader pair without returning the writer password', () => {
    const pair = validateA5ConnectionPair(
      'postgresql://writer:writer-secret@db.example:5432/watchdog?schema=public&sslmode=require',
      `postgresql://${A5_READER_ROLE}:reader%20secret@db.example/watchdog?schema=public&sslmode=require`,
      'uat',
    );

    assert.deepEqual(
      { host: pair.host, port: pair.port, database: pair.database, schema: pair.schema, readerPassword: pair.readerPassword },
      { host: 'db.example', port: '5432', database: 'watchdog', schema: 'public', readerPassword: 'reader secret' },
    );
    assert.equal(pair.targetEnvironment, 'uat');
    assert.equal(pair.readerRole, A5_READER_ROLE);
    assert.throws(() => validateA5ConnectionPair(
      pair.writerUrl,
      `postgresql://${A5_READER_ROLE}:secret@other.example/watchdog?schema=public`,
      'uat',
    ), /same host/);
  });

  it('requires a distinct production principal on the exact same database identity', () => {
    const writerUrl = 'postgresql://writer:writer-secret@prod-db.example:5432/watchdog?schema=public';
    const readerUrl = `postgresql://${A5_PRODUCTION_READER_ROLE}:reader-secret@prod-db.example/watchdog?schema=public`;
    const pair = validateA5ConnectionPair(writerUrl, readerUrl, 'production');

    assert.deepEqual(
      { targetEnvironment: pair.targetEnvironment, writerRole: pair.writerRole, readerRole: pair.readerRole },
      { targetEnvironment: 'production', writerRole: 'writer', readerRole: A5_PRODUCTION_READER_ROLE },
    );
    assert.throws(() => validateA5ConnectionPair(
      writerUrl,
      `postgresql://${A5_READER_ROLE}:reader-secret@prod-db.example/watchdog?schema=public`,
      'production',
    ), new RegExp(A5_PRODUCTION_READER_ROLE));
    assert.throws(() => validateA5ConnectionPair(
      `postgresql://${A5_READER_ROLE}:writer-secret@prod-db.example/watchdog?schema=public`,
      readerUrl,
      'production',
    ), /separate non-reader principal/);
    assert.throws(() => validateA5ConnectionPair(
      `${writerUrl}&host=uat-db.example`,
      readerUrl,
      'production',
    ), /must not override connection identity/);
    assert.throws(() => validateA5ConnectionPair(
      writerUrl,
      `${readerUrl}&user=${A5_READER_ROLE}`,
      'production',
    ), /must not override connection identity/);
    assert.throws(() => validateA5ConnectionPair(
      writerUrl,
      `${readerUrl}&options=-c%20role%3D${A5_READER_ROLE}`,
      'production',
    ), /must not override connection identity/);
    assert.throws(() => validateA5ConnectionPair(writerUrl, readerUrl, 'preview'), /must be uat or production/);
  });

  it('keeps UAT compatibility but requires an explicit matching production A5 target', () => {
    assert.equal(resolveA5TargetEnvironment({ DEPLOY_ENV: 'uat' }), 'uat');
    assert.equal(resolveA5TargetEnvironment({
      DEPLOY_ENVIRONMENT: 'uat',
      A5_TARGET_ENVIRONMENT: 'uat',
    }), 'uat');
    assert.equal(resolveA5TargetEnvironment({
      DEPLOY_ENV: 'production',
      DEPLOY_ENVIRONMENT: 'production',
      A5_TARGET_ENVIRONMENT: 'production',
    }), 'production');

    assert.throws(() => resolveA5TargetEnvironment({ DEPLOY_ENV: 'production' }), /explicit A5_TARGET_ENVIRONMENT/);
    assert.throws(() => resolveA5TargetEnvironment({
      DEPLOY_ENV: 'uat',
      A5_TARGET_ENVIRONMENT: 'production',
    }), /must match/);
    assert.throws(() => resolveA5TargetEnvironment({
      DEPLOY_ENV: 'uat',
      DEPLOY_ENVIRONMENT: 'production',
      A5_TARGET_ENVIRONMENT: 'production',
    }), /DEPLOY_ENVIRONMENT and DEPLOY_ENV must match/);
    assert.throws(() => resolveA5TargetEnvironment({ DEPLOY_ENV: 'preview' }), /must be uat or production/);
    assert.throws(() => resolveA5TargetEnvironment({ A5_TARGET_ENVIRONMENT: 'production' }), /DEPLOY_ENVIRONMENT or DEPLOY_ENV/);
  });

  it('requires explicit production schema profiles while UAT remains F1_CURRENT', () => {
    assert.equal(resolveA5SchemaProfile({}, 'uat'), 'F1_CURRENT');
    assert.equal(resolveA5SchemaProfile({ A5_SCHEMA_PROFILE: 'F1_CURRENT' }, 'uat'), 'F1_CURRENT');
    assert.equal(
      resolveA5SchemaProfile({ A5_SCHEMA_PROFILE: 'LEGACY_PRE_F1' }, 'production'),
      'LEGACY_PRE_F1',
    );
    assert.equal(resolveA5SchemaProfile({ A5_SCHEMA_PROFILE: 'F1_CURRENT' }, 'production'), 'F1_CURRENT');
    assert.throws(() => resolveA5SchemaProfile({}, 'production'), /requires explicit A5_SCHEMA_PROFILE/);
    assert.throws(
      () => resolveA5SchemaProfile({ A5_SCHEMA_PROFILE: 'LEGACY_PRE_F1' }, 'uat'),
      /UAT.*F1_CURRENT/,
    );
    assert.throws(
      () => resolveA5SchemaProfile({ A5_SCHEMA_PROFILE: 'UNKNOWN' }, 'production'),
      /LEGACY_PRE_F1 or F1_CURRENT/,
    );
  });

  it('accepts only the exact known LEGACY_PRE_F1 relation gap', () => {
    assert.deepEqual([...A5_LEGACY_PRE_F1_MISSING_CORE_TABLES], [
      'CompanyEntitlementNormalization',
      'EntitlementTransition',
      'FeatureLaunchGate',
      'FeatureLaunchGateTransition',
      'FeatureLaunchObservationBucket',
      'ExecutionAttempt',
      'RunoffSnapshot',
    ]);
    const knownMissing = new Set<string>(A5_LEGACY_PRE_F1_MISSING_CORE_TABLES);
    const legacyPresent = A5_CORE_TABLES.filter((table) => !knownMissing.has(table));
    assert.deepEqual(legacyPresent, [
      '_prisma_migrations',
      'Company',
      'CompanyFeatureEntitlement',
      'AuditLog',
      'CompanyOnboardingRun',
      'WorkflowTask',
    ]);

    assert.deepEqual(validateA5CoreTableCatalog('LEGACY_PRE_F1', legacyPresent), legacyPresent);
    assert.deepEqual(validateA5CoreTableCatalog('F1_CURRENT', A5_CORE_TABLES), [...A5_CORE_TABLES]);
    assert.throws(
      () => validateA5CoreTableCatalog('LEGACY_PRE_F1', legacyPresent.slice(1)),
      /LEGACY_PRE_F1 schema profile mismatch/,
    );
    assert.throws(
      () => validateA5CoreTableCatalog('LEGACY_PRE_F1', [
        ...legacyPresent,
        A5_LEGACY_PRE_F1_MISSING_CORE_TABLES[0],
      ]),
      /LEGACY_PRE_F1 schema profile mismatch/,
    );
    assert.throws(
      () => validateA5CoreTableCatalog('F1_CURRENT', A5_CORE_TABLES.slice(1)),
      /F1_CURRENT schema profile mismatch/,
    );

    const productionCurrent = a5EvidenceTableCatalog('production');
    assert.deepEqual(productionCurrent.slice(-2), [...A5_PRODUCTION_REIMBURSEMENT_TABLES]);
    const productionLegacy = productionCurrent.filter((table) => !new Set([
      ...A5_LEGACY_PRE_F1_MISSING_CORE_TABLES, 'ReimbursementLine',
    ]).has(table));
    assert.deepEqual(
      validateA5CoreTableCatalog('LEGACY_PRE_F1', productionLegacy, 'production'),
      productionLegacy,
    );
    assert.deepEqual(
      validateA5CoreTableCatalog('F1_CURRENT', productionCurrent, 'production'),
      productionCurrent,
    );
  });

  it('canonicalizes hashes and excludes only generatedAt/evidenceHash from estate identity', () => {
    const first = { generatedAt: '2026-08-03T00:00:00.000Z', beta: 2, alpha: { z: true, a: 'x' } };
    const second = { alpha: { a: 'x', z: true }, beta: 2, generatedAt: '2026-08-03T00:01:00.000Z' };

    assert.equal(stableJson(first.alpha), stableJson(second.alpha));
    assert.equal(stableJson({ a: 1, B: 2, A: 3, b: 4, _: 5 }), '{"A":3,"B":2,"_":5,"a":1,"b":4}');
    assert.equal(a5EvidenceHash(first), a5EvidenceHash(second));
    assert.match(A5_QUERY_CATALOG_HASH, /^[0-9a-f]{64}$/);
    assert.notEqual(a5EvidenceHash(first), a5EvidenceHash({ ...second, beta: 3 }));
  });

  it('finds migration name/checksum/unfinished drift deterministically', () => {
    const drift = compareMigrations(
      [
        { name: '001_first', checksum: 'aaa' },
        { name: '002_second', checksum: 'bbb' },
      ],
      [
        { name: '001_first', checksum: 'wrong', finishedAt: new Date(), rolledBackAt: null },
        { name: '003_remote', checksum: 'ccc', finishedAt: new Date(), rolledBackAt: null },
        { name: '004_running', checksum: 'ddd', finishedAt: null, rolledBackAt: null },
      ],
    );

    assert.deepEqual(drift.missingInDatabase, ['002_second']);
    assert.deepEqual(drift.unknownInDatabase, ['003_remote']);
    assert.deepEqual(drift.checksumMismatches, ['001_first']);
    assert.deepEqual(drift.unfinished, ['004_running']);
    assert.equal(drift.clean, false);
  });

  it('detects missing/extra launch rows and a gate fence that disagrees with transition history', () => {
    const catalog = compareLaunchCatalog([
      {
        gateKey: 'unexpected', routeKey: 'DEFAULT', gateExists: true,
        lastSeq: 2, maxTransitionSeq: 1,
      },
      {
        gateKey: 'orphan', routeKey: 'DEFAULT', gateExists: false,
        lastSeq: null, maxTransitionSeq: 1,
      },
    ]);

    assert.equal(catalog.clean, false);
    assert.ok(catalog.missingRows.length > 0);
    assert.deepEqual(catalog.extraRows, ['unexpected:DEFAULT']);
    assert.deepEqual(catalog.lastSeqMismatches, ['unexpected:DEFAULT']);
    assert.deepEqual(catalog.orphanTransitionRows, ['orphan:DEFAULT']);
  });

  it('blocks on reader authority defects but keeps shadow/capacity outside F2 blockers', () => {
    const validGuard = {
      currentUser: A5_READER_ROLE,
      transactionReadOnly: true,
      defaultTransactionReadOnly: true,
      roleNoInherit: true,
      roleNonPrivileged: true,
      roleMemberships: 0,
      missingCoreSelect: 0,
      outsideCoreSelect: 0,
      dmlPrivilegeTables: 0,
      sequencePrivilegeObjects: 0,
      securityDefinerExecute: 0,
      ownedObjects: 0,
      rowSecurityCoreTables: 0,
      databaseCreate: false,
      schemaCreate: false,
    };
    assert.deepEqual(readerGuardBlockers(validGuard), []);
    const productionGuard = { ...validGuard, currentUser: A5_PRODUCTION_READER_ROLE };
    assert.deepEqual(readerGuardBlockers(productionGuard, A5_PRODUCTION_READER_ROLE), []);
    assert.deepEqual(readerGuardBlockers(productionGuard), ['reader_role_mismatch']);
    assert.deepEqual(decideF2Precheck({
      guard: validGuard,
      migrationsClean: true,
      launchCatalogClean: true,
      whtOpenRoutes: 0,
    }), { ready: true, blockers: [] });
    assert.deepEqual(decideF2Precheck({
      guard: validGuard,
      migrationsClean: false,
      launchCatalogClean: false,
      whtOpenRoutes: 1,
    }), {
      ready: false,
      blockers: ['launch_catalog_drift', 'migration_drift', 'wht_route_open'],
    });
    assert.deepEqual(readerGuardBlockers({
      currentUser: 'writer',
      transactionReadOnly: false,
      defaultTransactionReadOnly: false,
      roleNoInherit: false,
      roleNonPrivileged: false,
      roleMemberships: 1,
      missingCoreSelect: 1,
      outsideCoreSelect: 1,
      dmlPrivilegeTables: 1,
      sequencePrivilegeObjects: 1,
      securityDefinerExecute: 1,
      ownedObjects: 1,
      rowSecurityCoreTables: 1,
      databaseCreate: true,
      schemaCreate: true,
    }), [
      'reader_role_mismatch',
      'transaction_not_read_only',
      'default_not_read_only',
      'reader_role_inherits',
      'reader_role_has_cluster_privilege',
      'reader_role_has_memberships',
      'core_select_missing',
      'forbidden_table_select',
      'dml_privilege_present',
      'sequence_privilege_present',
      'security_definer_execute_present',
      'reader_role_owns_objects',
      'core_table_row_security_present',
      'database_create_privilege_present',
      'schema_create_privilege_present',
    ]);
  });

  it('summarizes launch health without tenant or actor identifiers and keeps WHT visible', () => {
    const view = {
      gates: [
        {
          gateKey: 'cap.wht50bis', routeKey: 'SYSTEM_INITIAL_ISSUE', state: 'CLOSED',
          matrixRowStatus: 'RESOLVED', lastTransition: { actorUserId: 'secret-user-id' },
        },
        { gateKey: 'reports', routeKey: 'DEFAULT', state: 'OPEN', matrixRowStatus: 'RESOLVED' },
      ],
      featureLifecycle: [{ featureKey: 'reports', companiesOn: 2, companiesDraining: 0, companiesOff: 1 }],
      attempts: { QUEUED: 2 },
      shadowWindow: {
        windowHours: 24,
        fromHourUtc: '2026-08-02T00:00:00.000Z',
        environment: 'uat',
        builds: ['a'.repeat(40)],
        observed: 2,
        mapped: 2,
        wouldBlock: 0,
        hoursObserved: 1,
        observedRoutes: [
          { gateKey: 'inventory', routeKey: 'DEFAULT' },
          { gateKey: 'crm', routeKey: 'DEFAULT' },
        ],
        bySurface: {},
        unmappedBySurface: {},
      },
      evidenceTracks: {
        materialized: { present: 20, required: 20 },
        async: { catalogComplete: 13, observed: 2, required: 13 },
        synchronous: { journeysPassed: null, required: 3 },
        specialist: { accepted: null, required: 3 },
        deferred: { closed: 1, required: 1 },
      },
      unmaterializedMatrixRows: [],
    } as unknown as LaunchHealthView;

    const summary = summarizeLaunchHealth(view);
    assert.deepEqual(summary.wht50Bis, { total: 1, open: 0, closed: 1 });
    assert.equal(summary.gates.open, 1);
    assert.deepEqual(summary.shadowWindow.observedRoutes, [
      { gateKey: 'crm', routeKey: 'DEFAULT' },
      { gateKey: 'inventory', routeKey: 'DEFAULT' },
    ]);
    assert.deepEqual(summary.evidenceTracks.async, { catalogComplete: 13, observed: 2, required: 13 });
    assert.doesNotMatch(JSON.stringify(summary), /companyId|companyName|actorUserId|secret-user-id/);
  });
});
