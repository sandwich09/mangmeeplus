/**
 * One-time/idempotent bootstrap for the environment-specific A5-RO database principal.
 *
 * Required env: DATABASE_URL (writer), A5_READONLY_DATABASE_URL (reader), deployment environment.
 * Production additionally requires explicit A5_TARGET_ENVIRONMENT=production and A5_SCHEMA_PROFILE.
 * The reader password comes only from its URL, is re-applied on every run, and is never printed.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { Client } from 'pg';
import { PrismaClient } from '../src/generated/prisma/client';
import {
  a5EvidenceTableCatalog,
  inspectA5ReaderGuard,
  readerGuardBlockers,
  resolveA5SchemaProfile,
  resolveA5TargetEnvironment,
  validateA5CoreTableCatalog,
  validateA5ConnectionPair,
} from '../src/scripts/a5-readonly-evidence.logic';

function identifier(value: string): string {
  if (value.includes('\0')) throw new Error('SQL identifier contains NUL');
  return `"${value.replace(/"/g, '""')}"`;
}

function literal(value: string): string {
  if (value.includes('\0')) throw new Error('SQL literal contains NUL');
  return `'${value.replace(/'/g, "''")}'`;
}

type A5BootstrapInput = {
  writerUrl: string;
  readerUrl: string;
  targetEnvironment: string;
  schemaProfile?: string;
};

type A5RoleState = {
  canLogin: boolean;
  inherits: boolean;
  isSuperuser: boolean;
  canCreateDatabase: boolean;
  canCreateRole: boolean;
  canReplicate: boolean;
  bypassesRls: boolean;
  connectionLimit: number;
  writerHasAdmin: boolean;
};

export type A5RoleMember = {
  memberName: string;
  adminOption: boolean;
  inheritOption: boolean;
  setOption: boolean;
};

export function isClosedA5RoleMembership(
  members: readonly A5RoleMember[],
  writerRole: string,
): boolean {
  // Stock PostgreSQL 18 automatically records one creator ADMIN membership for a non-superuser
  // CREATEROLE writer. RDS grants its master equivalent administration through rds_superuser and
  // records no direct membership on the created role. Both are closed: no principal can inherit or
  // SET ROLE to the reader. The separate writerHasAdmin guard proves the writer can still harden it.
  return members.length <= 1 && members.every((member) =>
    member.memberName === writerRole
      && member.adminOption
      && !member.inheritOption
      && !member.setOption);
}

async function readA5RoleState(writer: Client, readerRole: string): Promise<A5RoleState | null> {
  const result = await writer.query<A5RoleState>(`
    SELECT r.rolcanlogin AS "canLogin",
           r.rolinherit AS inherits,
           r.rolsuper AS "isSuperuser",
           r.rolcreatedb AS "canCreateDatabase",
           r.rolcreaterole AS "canCreateRole",
           r.rolreplication AS "canReplicate",
           r.rolbypassrls AS "bypassesRls",
           r.rolconnlimit AS "connectionLimit",
           pg_has_role(current_user, r.oid, 'MEMBER WITH ADMIN OPTION') AS "writerHasAdmin"
      FROM pg_roles r
     WHERE r.rolname = $1
  `, [readerRole]);
  return result.rows[0] ?? null;
}

function assertNonPrivilegedRole(state: A5RoleState): void {
  if (state.isSuperuser || state.canCreateDatabase || state.canCreateRole
    || state.canReplicate || state.bypassesRls) {
    throw new Error('A5 reader role has privileged attributes; database-admin review is required');
  }
}

function assertManageableRole(state: A5RoleState, writerIsSuper: boolean): void {
  assertNonPrivilegedRole(state);
  if (!writerIsSuper && !state.writerHasAdmin) {
    throw new Error('writer lacks ADMIN OPTION on the existing A5 reader role');
  }
}

async function assertClosedRoleMembership(
  writer: Client,
  writerRole: string,
  readerRole: string,
): Promise<void> {
  const members = await writer.query<A5RoleMember>(`
    SELECT member.rolname AS "memberName",
           m.admin_option AS "adminOption",
           m.inherit_option AS "inheritOption",
           m.set_option AS "setOption"
      FROM pg_auth_members m
      JOIN pg_roles granted ON granted.oid = m.roleid
      JOIN pg_roles member ON member.oid = m.member
     WHERE granted.rolname = $1
     ORDER BY member.rolname
  `, [readerRole]);
  if (!isClosedA5RoleMembership(members.rows, writerRole)) {
    throw new Error('A5 reader role has unexpected member authority; database-admin review is required');
  }
}

export async function bootstrapA5Readonly(input: A5BootstrapInput): Promise<void> {
  const { writerUrl, readerUrl, targetEnvironment, schemaProfile: requestedSchemaProfile } = input;
  const pair = validateA5ConnectionPair(writerUrl, readerUrl, targetEnvironment);
  const schemaProfile = resolveA5SchemaProfile(
    { A5_SCHEMA_PROFILE: requestedSchemaProfile },
    pair.targetEnvironment,
  );
  const role = identifier(pair.readerRole);
  const schema = identifier(pair.schema);
  const database = identifier(pair.database);
  let grantedCoreTables: string[] = [];
  const writer = new Client({ connectionString: pair.writerUrl });
  await writer.connect();
  try {
    await writer.query('BEGIN');
    await writer.query("SELECT pg_advisory_xact_lock(hashtext('watchdog:a5-ro-bootstrap'))");
    const live = await writer.query<{
      database: string;
      writer_role: string;
      writer_is_super: boolean;
      writer_can_manage_roles: boolean;
      schema_exists: boolean;
    }>(`
      SELECT current_database() AS database,
             current_user AS writer_role,
             r.rolsuper AS writer_is_super,
             (r.rolsuper OR r.rolcreaterole) AS writer_can_manage_roles,
             EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = $1) AS schema_exists
        FROM pg_roles r
       WHERE r.rolname = current_user
    `, [pair.schema]);
    const identity = live.rows[0];
    if (!identity || identity.database !== pair.database || identity.writer_role !== pair.writerRole
      || !identity.schema_exists) {
      throw new Error('writer connection does not match the reviewed database/schema identity');
    }
    if (!identity.writer_can_manage_roles) throw new Error('writer cannot create or harden the A5 role');

    const evidenceTables = a5EvidenceTableCatalog(pair.targetEnvironment);
    const presentCoreTables = await writer.query<{ relation_name: string }>(`
      SELECT c.relname AS relation_name
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = $1
         AND c.relname = ANY($2::text[])
         AND c.relkind IN ('r', 'p')
       ORDER BY c.relname
    `, [pair.schema, evidenceTables]);
    grantedCoreTables = validateA5CoreTableCatalog(
      schemaProfile,
      presentCoreTables.rows.map((row) => row.relation_name),
      pair.targetEnvironment,
    );
    const tableList = grantedCoreTables
      .map((table) => `${schema}.${identifier(table)}`)
      .join(', ');

    let roleState = await readA5RoleState(writer, pair.readerRole);
    if (!roleState) {
      // PostgreSQL defaults every privileged flag to false. Do not explicitly issue NO* variants
      // for SUPERUSER/REPLICATION/BYPASSRLS: an RDS master is deliberately not allowed to alter
      // those attributes, even from false to false. The pre/post guards below prove the outcome.
      await writer.query(`CREATE ROLE ${role} LOGIN NOINHERIT`);
      roleState = await readA5RoleState(writer, pair.readerRole);
    }
    if (!roleState) throw new Error('A5 reader role was not created');
    assertManageableRole(roleState, identity.writer_is_super);
    await assertClosedRoleMembership(writer, identity.writer_role, pair.readerRole);

    const memberships = await writer.query<{ role_name: string }>(`
      SELECT granted.rolname AS role_name
        FROM pg_auth_members m
        JOIN pg_roles granted ON granted.oid = m.roleid
        JOIN pg_roles member ON member.oid = m.member
       WHERE member.rolname = $1
    `, [pair.readerRole]);
    for (const membership of memberships.rows) {
      await writer.query(`REVOKE ${identifier(membership.role_name)} FROM ${role}`);
    }

    // F2 plans four companies concurrently; allow that bounded reader fan-out plus Prisma's
    // transaction/metadata connection without granting any additional authority.
    await writer.query(`ALTER ROLE ${role} WITH LOGIN NOINHERIT CONNECTION LIMIT 8 PASSWORD ${literal(pair.readerPassword)}`);
    await writer.query(`ALTER ROLE ${role} RESET ALL`);
    await writer.query(`ALTER ROLE ${role} SET default_transaction_read_only = on`);
    await writer.query(`ALTER ROLE ${role} SET statement_timeout = '30s'`);
    await writer.query(`ALTER ROLE ${role} SET lock_timeout = '5s'`);
    await writer.query(`ALTER ROLE ${role} SET idle_in_transaction_session_timeout = '30s'`);
    await writer.query(`ALTER ROLE ${role} SET search_path TO ${schema}`);

    // Reset every direct authority across every non-system schema before granting the closed
    // reviewed table catalog. Restricting this to `public` would let a reused role retain access through
    // an old application/extension schema while still passing the active-schema check.
    await writer.query(`REVOKE ALL PRIVILEGES ON DATABASE ${database} FROM ${role}`);
    const applicationSchemas = await writer.query<{ schema_name: string }>(`
      SELECT nspname AS schema_name
        FROM pg_namespace
       WHERE nspname NOT IN ('pg_catalog', 'information_schema')
         AND nspname NOT LIKE 'pg_toast%'
         AND nspname NOT LIKE 'pg_temp_%'
       ORDER BY nspname
    `);
    for (const row of applicationSchemas.rows) {
      const applicationSchema = identifier(row.schema_name);
      await writer.query(`REVOKE ALL PRIVILEGES ON SCHEMA ${applicationSchema} FROM ${role}`);
      await writer.query(`REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA ${applicationSchema} FROM ${role}`);
      await writer.query(`REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA ${applicationSchema} FROM ${role}`);
      await writer.query(`REVOKE ALL PRIVILEGES ON ALL ROUTINES IN SCHEMA ${applicationSchema} FROM ${role}`);
    }
    await writer.query(`GRANT CONNECT ON DATABASE ${database} TO ${role}`);
    await writer.query(`GRANT USAGE ON SCHEMA ${schema} TO ${role}`);
    await writer.query(`GRANT SELECT ON TABLE ${tableList} TO ${role}`);

    const hardenedRole = await readA5RoleState(writer, pair.readerRole);
    if (!hardenedRole) throw new Error('A5 reader role disappeared during bootstrap');
    assertManageableRole(hardenedRole, identity.writer_is_super);
    if (!hardenedRole.canLogin || hardenedRole.inherits || hardenedRole.connectionLimit !== 8) {
      throw new Error('A5 reader role login/inheritance/connection-limit hardening failed');
    }
    const remainingMemberships = await writer.query<{ memberships: number }>(`
      SELECT COUNT(*)::int AS memberships
        FROM pg_auth_members m
        JOIN pg_roles member ON member.oid = m.member
       WHERE member.rolname = $1
    `, [pair.readerRole]);
    if ((remainingMemberships.rows[0]?.memberships ?? -1) !== 0) {
      throw new Error('A5 reader role still has role memberships after hardening');
    }
    await assertClosedRoleMembership(writer, identity.writer_role, pair.readerRole);

    const owned = await writer.query<{ owned_objects: number }>(`
      SELECT COUNT(*)::int AS owned_objects
        FROM pg_shdepend d
        JOIN pg_roles r ON r.oid = d.refobjid
       WHERE d.refclassid = 'pg_authid'::regclass
         AND d.deptype = 'o'
         AND r.rolname = $1
    `, [pair.readerRole]);
    if ((owned.rows[0]?.owned_objects ?? 0) !== 0) {
      throw new Error('A5 reader role owns application objects; ownership must be removed before use');
    }
    await writer.query('COMMIT');
  } catch (error) {
    await writer.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await writer.end();
  }

  // Verify through a fresh reader login, so role defaults/password/grants are proven after commit.
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: pair.readerUrl }) });
  try {
    const guard = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      return inspectA5ReaderGuard(tx, pair.schema, grantedCoreTables);
    }, { isolationLevel: 'RepeatableRead', maxWait: 5_000, timeout: 30_000 });
    const blockers = readerGuardBlockers(guard, pair.readerRole);
    if (blockers.length > 0) throw new Error(`reader verification failed (${blockers.join(',')})`);
    console.log(JSON.stringify({
      artifact: 'a5-readonly-bootstrap',
      targetEnvironment: pair.targetEnvironment,
      role: pair.readerRole,
      database: pair.database,
      schema: pair.schema,
      schemaProfile,
      coreTablesGranted: grantedCoreTables.length,
      readOnlyVerified: true,
      forbiddenTableAccessVerifiedAbsent: true,
      dmlPrivilegesVerifiedAbsent: true,
    }));
  } finally {
    await prisma.$disconnect();
  }
}

async function bootstrapFromEnvironment(): Promise<void> {
  const writerUrl = process.env['DATABASE_URL'] ?? '';
  const readerUrl = process.env['A5_READONLY_DATABASE_URL'] ?? '';
  if (writerUrl === '' || readerUrl === '') {
    throw new Error('DATABASE_URL and A5_READONLY_DATABASE_URL are required');
  }
  const targetEnvironment = resolveA5TargetEnvironment(process.env);
  const schemaProfile = resolveA5SchemaProfile(process.env, targetEnvironment);
  await bootstrapA5Readonly({ writerUrl, readerUrl, targetEnvironment, schemaProfile });
}

if (require.main === module) bootstrapFromEnvironment().catch((error) => {
  const secrets = [process.env['DATABASE_URL'], process.env['A5_READONLY_DATABASE_URL']]
    .filter((value): value is string => Boolean(value));
  let message = error instanceof Error ? error.message : 'unknown error';
  for (const secret of secrets) message = message.replaceAll(secret, '[REDACTED_DATABASE_URL]');
  console.error(`A5 read-only bootstrap failed: ${message}`);
  process.exitCode = 1;
});
