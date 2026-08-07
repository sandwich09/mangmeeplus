import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Client } from 'pg';
import {
  A5_CORE_TABLES,
  A5_LEGACY_PRE_F1_MISSING_CORE_TABLES,
  A5_PRODUCTION_REIMBURSEMENT_TABLES,
  A5_PRODUCTION_READER_ROLE,
  A5_READER_ROLE,
} from '../src/scripts/a5-readonly-evidence.logic';
import { bootstrapA5Readonly, isClosedA5RoleMembership } from './bootstrap-a5-readonly';

const rootUrl = process.env['A5_BOOTSTRAP_TEST_DATABASE_URL'] ?? '';
const schema = 'a5_bootstrap_test';
const writerRole = 'a5_bootstrap_writer';
const leakRole = 'a5_bootstrap_leak_member';
const writerPassword = 'a5-bootstrap-writer-test';
const readerPassword = 'a5-bootstrap-reader-test';
const readerRoles = [A5_READER_ROLE, A5_PRODUCTION_READER_ROLE] as const;

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function roleUrl(base: string, username: string, password: string): string {
  const url = new URL(base);
  url.username = username;
  url.password = password;
  url.searchParams.set('schema', schema);
  return url.toString();
}

describe('A5 read-only role membership guard', () => {
  const safeCreator = {
    memberName: writerRole,
    adminOption: true,
    inheritOption: false,
    setOption: false,
  };

  it('accepts the closed PostgreSQL and RDS creator shapes', () => {
    assert.equal(isClosedA5RoleMembership([], writerRole), true);
    assert.equal(isClosedA5RoleMembership([safeCreator], writerRole), true);
  });

  it('rejects every member that can inherit or assume the reader', () => {
    assert.equal(isClosedA5RoleMembership([{ ...safeCreator, inheritOption: true }], writerRole), false);
    assert.equal(isClosedA5RoleMembership([{ ...safeCreator, setOption: true }], writerRole), false);
    assert.equal(isClosedA5RoleMembership([{ ...safeCreator, adminOption: false }], writerRole), false);
    assert.equal(isClosedA5RoleMembership([{ ...safeCreator, memberName: leakRole }], writerRole), false);
    assert.equal(isClosedA5RoleMembership([safeCreator, safeCreator], writerRole), false);
    assert.equal(isClosedA5RoleMembership([safeCreator, { ...safeCreator, memberName: leakRole }], writerRole), false);
  });
});

describe('A5 read-only role bootstrap against PostgreSQL', { skip: rootUrl === '' }, () => {
  it('works for a non-superuser CREATEROLE writer and rejects unmanaged or privileged roles', async () => {
    const root = new Client({ connectionString: rootUrl });
    await root.connect();
    const database = new URL(rootUrl).pathname.replace(/^\//, '');
    assert.match(database, /_ci$/, 'the role DDL spec must run only against an isolated CI database');
    const clusterDatabases = (await root.query<{ datname: string }>(
      'SELECT datname FROM pg_database WHERE NOT datistemplate ORDER BY datname',
    )).rows.map((row) => row.datname);
    assert.deepEqual(
      clusterDatabases,
      [database, 'postgres'].sort(),
      'the role DDL spec requires a disposable PostgreSQL cluster with no other databases',
    );
    const preexistingRoles = (await root.query<{ rolname: string }>(
      'SELECT rolname FROM pg_roles WHERE rolname = ANY($1::text[]) ORDER BY rolname',
      [[...readerRoles, writerRole, leakRole]],
    )).rows;
    assert.deepEqual(
      preexistingRoles,
      [],
      'the disposable PostgreSQL cluster must not contain any target test role before execution',
    );

    const cleanup = async () => {
      await root.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`);
      const existingRoles = new Set((await root.query<{ rolname: string }>(
        'SELECT rolname FROM pg_roles WHERE rolname = ANY($1::text[])',
        [[...readerRoles, writerRole, leakRole]],
      )).rows.map((row) => row.rolname));
      for (const readerRole of readerRoles) {
        if (existingRoles.has(readerRole) && existingRoles.has(leakRole)) {
          await root.query(`REVOKE ${quoteIdentifier(readerRole)} FROM ${quoteIdentifier(leakRole)}`);
        }
      }
      await root.query(`DROP OWNED BY ${quoteIdentifier(leakRole)}`).catch(() => undefined);
      await root.query(`DROP ROLE IF EXISTS ${quoteIdentifier(leakRole)}`);
      for (const readerRole of readerRoles) {
        if (existingRoles.has(readerRole) && existingRoles.has(writerRole)) {
          await root.query(`SET ROLE ${quoteIdentifier(writerRole)}`);
          await root.query(`REVOKE ALL PRIVILEGES ON DATABASE ${quoteIdentifier(database)} FROM ${quoteIdentifier(readerRole)}`);
          await root.query('RESET ROLE');
        }
        await root.query(`DROP OWNED BY ${quoteIdentifier(readerRole)}`).catch(() => undefined);
        await root.query(`DROP ROLE IF EXISTS ${quoteIdentifier(readerRole)}`);
      }
      await root.query(`REVOKE ALL PRIVILEGES ON DATABASE ${quoteIdentifier(database)} FROM ${quoteIdentifier(writerRole)}`).catch(() => undefined);
      await root.query(`DROP OWNED BY ${quoteIdentifier(writerRole)}`).catch(() => undefined);
      await root.query(`DROP ROLE IF EXISTS ${quoteIdentifier(writerRole)}`);
    };

    try {
      await cleanup();
      await root.query(`CREATE ROLE ${quoteIdentifier(writerRole)} LOGIN CREATEROLE PASSWORD '${writerPassword}'`);
      await root.query(`GRANT CONNECT ON DATABASE ${quoteIdentifier(database)} TO ${quoteIdentifier(writerRole)} WITH GRANT OPTION`);
      await root.query(`CREATE SCHEMA ${quoteIdentifier(schema)} AUTHORIZATION ${quoteIdentifier(writerRole)}`);
      await root.query(`SET ROLE ${quoteIdentifier(writerRole)}`);
      for (const table of [...A5_CORE_TABLES, ...A5_PRODUCTION_REIMBURSEMENT_TABLES]) {
        await root.query(`CREATE TABLE ${quoteIdentifier(schema)}.${quoteIdentifier(table)} (id text)`);
      }
      await root.query('RESET ROLE');

      const writerUrl = roleUrl(rootUrl, writerRole, writerPassword);
      const readerUrl = roleUrl(rootUrl, A5_READER_ROLE, readerPassword);
      const [{ server_version_num: version }] = (await root.query<{ server_version_num: string }>(
        "SELECT current_setting('server_version_num') AS server_version_num",
      )).rows;
      const serverMajor = Math.floor(Number(version) / 10_000);
      assert.ok(serverMajor >= 18, 'the A5 production bootstrap spec requires PostgreSQL 18 or newer');
      const runBootstrap = () => bootstrapA5Readonly({ writerUrl, readerUrl, targetEnvironment: 'uat' });

      await runBootstrap();
      await runBootstrap();
      const hardened = (await root.query<{
        can_login: boolean;
        inherits: boolean;
        is_superuser: boolean;
        can_create_database: boolean;
        can_create_role: boolean;
        can_replicate: boolean;
        bypasses_rls: boolean;
        connection_limit: number;
        writer_has_admin: boolean;
      }>(`
        SELECT r.rolcanlogin AS can_login,
               r.rolinherit AS inherits,
               r.rolsuper AS is_superuser,
               r.rolcreatedb AS can_create_database,
               r.rolcreaterole AS can_create_role,
               r.rolreplication AS can_replicate,
               r.rolbypassrls AS bypasses_rls,
               r.rolconnlimit AS connection_limit,
               pg_has_role($1::name, r.oid, 'MEMBER WITH ADMIN OPTION') AS writer_has_admin
          FROM pg_roles r
         WHERE r.rolname = $2
      `, [writerRole, A5_READER_ROLE])).rows[0];
      assert.deepEqual(hardened, {
        can_login: true,
        inherits: false,
        is_superuser: false,
        can_create_database: false,
        can_create_role: false,
        can_replicate: false,
        bypasses_rls: false,
        connection_limit: 8,
        writer_has_admin: true,
      });

      await root.query(`CREATE ROLE ${quoteIdentifier(leakRole)} LOGIN`);
      await root.query(`GRANT ${quoteIdentifier(A5_READER_ROLE)} TO ${quoteIdentifier(leakRole)}`);
      await assert.rejects(
        bootstrapA5Readonly({ writerUrl, readerUrl, targetEnvironment: 'uat' }),
        /unexpected member authority/,
      );
      await root.query(`REVOKE ${quoteIdentifier(A5_READER_ROLE)} FROM ${quoteIdentifier(leakRole)}`);
      await root.query(`DROP ROLE ${quoteIdentifier(leakRole)}`);

      await root.query(`SET ROLE ${quoteIdentifier(writerRole)}`);
      await root.query(`REVOKE ALL PRIVILEGES ON DATABASE ${quoteIdentifier(database)} FROM ${quoteIdentifier(A5_READER_ROLE)}`);
      await root.query('RESET ROLE');
      await root.query(`DROP OWNED BY ${quoteIdentifier(A5_READER_ROLE)}`);
      await root.query(`DROP ROLE ${quoteIdentifier(A5_READER_ROLE)}`);
      await root.query(`CREATE ROLE ${quoteIdentifier(A5_READER_ROLE)} LOGIN NOINHERIT`);
      await assert.rejects(
        bootstrapA5Readonly({ writerUrl, readerUrl, targetEnvironment: 'uat' }),
        /lacks ADMIN OPTION/,
      );

      await root.query(`DROP ROLE ${quoteIdentifier(A5_READER_ROLE)}`);
      await root.query(`CREATE ROLE ${quoteIdentifier(A5_READER_ROLE)} LOGIN NOINHERIT CREATEDB`);
      await root.query(`GRANT ${quoteIdentifier(A5_READER_ROLE)} TO ${quoteIdentifier(writerRole)} WITH ADMIN OPTION`);
      await assert.rejects(
        bootstrapA5Readonly({ writerUrl, readerUrl, targetEnvironment: 'uat' }),
        /has privileged attributes/,
      );
      const privileged = (await root.query<{ can_create_database: boolean }>(
        'SELECT rolcreatedb AS can_create_database FROM pg_roles WHERE rolname = $1',
        [A5_READER_ROLE],
      )).rows[0];
      assert.equal(privileged?.can_create_database, true, 'a rejected privileged role must not be silently demoted');

      await root.query(`DROP ROLE ${quoteIdentifier(A5_READER_ROLE)}`);
      const productionReaderUrl = roleUrl(rootUrl, A5_PRODUCTION_READER_ROLE, readerPassword);
      await assert.rejects(
        bootstrapA5Readonly({ writerUrl, readerUrl: productionReaderUrl, targetEnvironment: 'production' }),
        /requires explicit A5_SCHEMA_PROFILE/,
      );
      await bootstrapA5Readonly({
        writerUrl,
        readerUrl: productionReaderUrl,
        targetEnvironment: 'production',
        schemaProfile: 'F1_CURRENT',
      });
      const productionReader = new Client({ connectionString: productionReaderUrl });
      await productionReader.connect();
      try {
        const [identity] = (await productionReader.query<{
          current_user: string;
          transaction_read_only: string;
          default_transaction_read_only: string;
        }>(`
          SELECT current_user,
                 current_setting('transaction_read_only') AS transaction_read_only,
                 current_setting('default_transaction_read_only') AS default_transaction_read_only
        `)).rows;
        assert.deepEqual(identity, {
          current_user: A5_PRODUCTION_READER_ROLE,
          transaction_read_only: 'on',
          default_transaction_read_only: 'on',
        });
        await assert.rejects(
          productionReader.query(`INSERT INTO ${quoteIdentifier(schema)}.${quoteIdentifier(A5_CORE_TABLES[0])} (id) VALUES ('forbidden')`),
          /read-only transaction|permission denied/,
        );
      } finally {
        await productionReader.end();
      }

      const productionLegacyMissing = [
        ...A5_LEGACY_PRE_F1_MISSING_CORE_TABLES,
        'ReimbursementLine',
      ];
      for (const table of productionLegacyMissing) {
        await root.query(`DROP TABLE ${quoteIdentifier(schema)}.${quoteIdentifier(table)}`);
      }
      const runLegacyBootstrap = () => bootstrapA5Readonly({
        writerUrl,
        readerUrl: productionReaderUrl,
        targetEnvironment: 'production',
        schemaProfile: 'LEGACY_PRE_F1',
      });
      await runLegacyBootstrap();

      const oneFewerMissing = productionLegacyMissing[0]!;
      await root.query(`SET ROLE ${quoteIdentifier(writerRole)}`);
      await root.query(`CREATE TABLE ${quoteIdentifier(schema)}.${quoteIdentifier(oneFewerMissing)} (id text)`);
      await root.query('RESET ROLE');
      await assert.rejects(runLegacyBootstrap(), /LEGACY_PRE_F1 schema profile mismatch/);
      await root.query(`DROP TABLE ${quoteIdentifier(schema)}.${quoteIdentifier(oneFewerMissing)}`);

      const oneExtraMissing = 'WorkflowTask';
      await root.query(`DROP TABLE ${quoteIdentifier(schema)}.${quoteIdentifier(oneExtraMissing)}`);
      await assert.rejects(runLegacyBootstrap(), /LEGACY_PRE_F1 schema profile mismatch/);
    } finally {
      await root.query('RESET ROLE').catch(() => undefined);
      await cleanup().catch(() => undefined);
      await root.end();
    }
  });
});
