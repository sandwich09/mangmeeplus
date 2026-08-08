-- Support access database roles — T1 VIEW and T2 EXECUTE
--
--   watchdog_support_ro  read-only, always available          (T1 VIEW)
--   watchdog_support_rw  write-capable, NOLOGIN until armed   (T2 EXECUTE)
--
-- Run as the writer/master role that owns the application schema:
--   psql "$WRITER_DATABASE_URL" -v ON_ERROR_STOP=1 -f infra/production/bootstrap-support-roles.sql
--
-- ORDERING: run this AFTER the first deploy has applied migrations. It references
-- "_prisma_migrations" and "AuditLog" by name, so against an empty schema it stops at
--   ERROR: relation "_prisma_migrations" does not exist
-- (verified on PostgreSQL 16, 2026-08-08). That failure is the correct behaviour and must not be
-- softened: the whole file runs in one transaction, so a partial run commits nothing, whereas a
-- version that skipped missing tables would quietly create a role whose write privileges were
-- never fenced off from the migration catalog.
--
-- Idempotent: every run re-applies the whole privilege set, so drift is corrected rather than
-- accumulated. Re-running never disarms watchdog_support_rw — arm-support-execute.sh owns that
-- state exclusively, and a bootstrap that silently closed an in-progress incident would be worse
-- than one that leaves it open.
--
-- No passwords anywhere. Both roles authenticate with RDS IAM (15-minute tokens), so there is
-- nothing to store, rotate, or leak through this file.
--
-- Deliberately NOT granted: DDL, TRUNCATE, CREATE on any schema, role management, object
-- ownership, and any write to "_prisma_migrations". See the verification block at the bottom —
-- it fails the transaction rather than trusting that the grants above did what they read like.

\set ON_ERROR_STOP on

BEGIN;

-- Same advisory-lock pattern as prisma/bootstrap-a5-readonly.ts: two concurrent runs would
-- interleave REVOKE and GRANT and leave a half-privileged role behind.
SELECT pg_advisory_xact_lock(hashtext('watchdog:support-roles-bootstrap'));

DO $$
BEGIN
  -- pg_read_all_data landed in PostgreSQL 14. Without it this script would have to enumerate
  -- tables, and every future migration would silently drop its new tables out of support's reach.
  IF current_setting('server_version_num')::int < 140000 THEN
    RAISE EXCEPTION 'pg_read_all_data requires PostgreSQL 14+ (found %)', current_setting('server_version');
  END IF;

  -- rds_iam only exists on Amazon RDS. Its absence means IAM authentication is unavailable and
  -- these roles would end up needing stored passwords, which is a different design.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rds_iam') THEN
    RAISE EXCEPTION 'role rds_iam not found - this script targets Amazon RDS only';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolcreaterole)
  ) THEN
    RAISE EXCEPTION 'current_user % cannot create or alter roles', current_user;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- T1 VIEW - watchdog_support_ro
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'watchdog_support_ro') THEN
    CREATE ROLE watchdog_support_ro LOGIN;
  END IF;
END $$;

-- INHERIT, unlike the NOINHERIT used by watchdog_a5_ro: pg_read_all_data is a membership, so a
-- NOINHERIT role would hold it without being able to use it without an explicit SET ROLE.
-- Connection limit 4 covers one operator plus a stuck session, and cannot starve the application.
ALTER ROLE watchdog_support_ro WITH LOGIN INHERIT CONNECTION LIMIT 4;

GRANT rds_iam TO watchdog_support_ro;
GRANT pg_read_all_data TO watchdog_support_ro;

ALTER ROLE watchdog_support_ro RESET ALL;
-- Read-only is enforced by the server, not by operator discipline: even a typo'd UPDATE aborts.
ALTER ROLE watchdog_support_ro SET default_transaction_read_only = on;
-- 15s is generous for a support lookup and short enough that an accidental full scan on a large
-- table dies before it affects anyone. lock_timeout matters more than statement_timeout here:
-- a SELECT that waits behind a migration's ACCESS EXCLUSIVE lock is itself a queue everyone
-- else then waits behind.
ALTER ROLE watchdog_support_ro SET statement_timeout = '15s';
ALTER ROLE watchdog_support_ro SET lock_timeout = '2s';
ALTER ROLE watchdog_support_ro SET idle_in_transaction_session_timeout = '60s';

-- ---------------------------------------------------------------------------
-- T2 EXECUTE - watchdog_support_rw
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'watchdog_support_rw') THEN
    -- NOLOGIN on creation only. Subsequent runs must not touch LOGIN state.
    CREATE ROLE watchdog_support_rw NOLOGIN;
  END IF;
END $$;

-- No LOGIN/NOLOGIN here on purpose - see the file header.
ALTER ROLE watchdog_support_rw WITH INHERIT CONNECTION LIMIT 2;

GRANT rds_iam TO watchdog_support_rw;
GRANT pg_read_all_data TO watchdog_support_rw;

ALTER ROLE watchdog_support_rw RESET ALL;
ALTER ROLE watchdog_support_rw SET statement_timeout = '30s';
ALTER ROLE watchdog_support_rw SET lock_timeout = '2s';
ALTER ROLE watchdog_support_rw SET idle_in_transaction_session_timeout = '60s';

GRANT INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO watchdog_support_rw;

DO $$
BEGIN
  -- Default privileges are recorded per creating role. This binds them to whoever runs
  -- migrations, which is the same role running this script; if that ever changes, tables created
  -- by the new owner will not carry these grants and this script must be re-run as that role.
  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public '
    'GRANT INSERT, UPDATE, DELETE ON TABLES TO watchdog_support_rw',
    current_user
  );

  -- CONNECT only: no TEMP (no scratch tables to smuggle data into) and no CREATE.
  EXECUTE format(
    'REVOKE ALL PRIVILEGES ON DATABASE %I FROM watchdog_support_ro, watchdog_support_rw',
    current_database()
  );
  EXECUTE format(
    'GRANT CONNECT ON DATABASE %I TO watchdog_support_ro, watchdog_support_rw',
    current_database()
  );
END $$;

REVOKE CREATE ON SCHEMA public FROM watchdog_support_ro, watchdog_support_rw;

-- Two tables the write role must never modify.
--
-- "_prisma_migrations" is the migration catalog. Editing it by hand is the one action that can
-- make prisma/verify-applied-migration-catalog.ts disagree with reality, which stops every future
-- deploy for a reason nobody will connect back to an incident weeks earlier. REVOKE here strips
-- only the direct DML grant above - SELECT still arrives through pg_read_all_data, which is what
-- support actually needs (checking whether a migration landed).
REVOKE ALL PRIVILEGES ON TABLE "_prisma_migrations" FROM watchdog_support_rw;

-- "AuditLog" stays append-only for this role. A break-glass session must be able to record what
-- it did; it must not be able to erase what it did.
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "AuditLog" FROM watchdog_support_rw;

-- ---------------------------------------------------------------------------
-- Verification - fails the transaction rather than reporting a wrong success
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  ro pg_roles%ROWTYPE;
  rw pg_roles%ROWTYPE;
  owned_objects int;
  stray_db_grants int;
  stray_schema_grants int;
BEGIN
  SELECT * INTO ro FROM pg_roles WHERE rolname = 'watchdog_support_ro';
  IF NOT FOUND THEN RAISE EXCEPTION 'watchdog_support_ro was not created'; END IF;
  SELECT * INTO rw FROM pg_roles WHERE rolname = 'watchdog_support_rw';
  IF NOT FOUND THEN RAISE EXCEPTION 'watchdog_support_rw was not created'; END IF;

  IF ro.rolsuper OR ro.rolcreatedb OR ro.rolcreaterole OR ro.rolreplication OR ro.rolbypassrls
     OR rw.rolsuper OR rw.rolcreatedb OR rw.rolcreaterole OR rw.rolreplication OR rw.rolbypassrls THEN
    RAISE EXCEPTION 'a support role holds privileged attributes; database-admin review required';
  END IF;

  IF NOT ro.rolcanlogin OR NOT ro.rolinherit OR ro.rolconnlimit <> 4 THEN
    RAISE EXCEPTION 'watchdog_support_ro login/inherit/connection-limit hardening failed';
  END IF;
  IF NOT rw.rolinherit OR rw.rolconnlimit <> 2 THEN
    RAISE EXCEPTION 'watchdog_support_rw inherit/connection-limit hardening failed';
  END IF;

  -- bypassrls false above is not enough on its own: a role that owns tables can alter or drop
  -- them regardless of the grants, so ownership is checked separately.
  SELECT count(*) INTO owned_objects
    FROM pg_shdepend d
    JOIN pg_roles r ON r.oid = d.refobjid
   WHERE d.refclassid = 'pg_authid'::regclass
     AND d.deptype = 'o'
     AND r.rolname IN ('watchdog_support_ro', 'watchdog_support_rw');
  IF owned_objects <> 0 THEN
    RAISE EXCEPTION 'a support role owns % application object(s); ownership must be removed', owned_objects;
  END IF;

  IF has_table_privilege('watchdog_support_ro', '"AuditLog"', 'INSERT')
     OR has_table_privilege('watchdog_support_ro', '"AuditLog"', 'UPDATE')
     OR has_table_privilege('watchdog_support_ro', '"AuditLog"', 'DELETE') THEN
    RAISE EXCEPTION 'watchdog_support_ro has write privileges; it must be read-only';
  END IF;

  IF has_table_privilege('watchdog_support_rw', '"_prisma_migrations"', 'INSERT')
     OR has_table_privilege('watchdog_support_rw', '"_prisma_migrations"', 'UPDATE')
     OR has_table_privilege('watchdog_support_rw', '"_prisma_migrations"', 'DELETE') THEN
    RAISE EXCEPTION 'watchdog_support_rw can write the migration catalog';
  END IF;
  IF NOT has_table_privilege('watchdog_support_rw', '"_prisma_migrations"', 'SELECT') THEN
    RAISE EXCEPTION 'watchdog_support_rw cannot read the migration catalog; support needs this';
  END IF;

  IF has_table_privilege('watchdog_support_rw', '"AuditLog"', 'UPDATE')
     OR has_table_privilege('watchdog_support_rw', '"AuditLog"', 'DELETE') THEN
    RAISE EXCEPTION 'watchdog_support_rw can rewrite the audit log; it must be append-only';
  END IF;

  -- has_database_privilege() answers "can this role do it", which folds in PUBLIC's defaults.
  -- PostgreSQL grants CONNECT and TEMPORARY to PUBLIC on every database, so asking it about TEMP
  -- returns true for any role at all, including ones with no relationship to this script. The
  -- question worth asking is what was granted *directly*, so inspect the ACL.
  --
  -- TEMP is deliberately left alone. Revoking it from PUBLIC would change the application's own
  -- rights to fix a support role, and a session-local temp table is not a capability worth that
  -- trade: it dies with the connection, and default_transaction_read_only blocks it for the read
  -- role regardless. CREATE (create schemas) is not a PUBLIC default and must stay absent.
  SELECT count(*) INTO stray_db_grants
    FROM pg_database d
    CROSS JOIN LATERAL aclexplode(d.datacl) a
    JOIN pg_roles r ON r.oid = a.grantee
   WHERE d.datname = current_database()
     AND r.rolname IN ('watchdog_support_ro', 'watchdog_support_rw')
     AND a.privilege_type <> 'CONNECT';
  IF stray_db_grants <> 0 THEN
    RAISE EXCEPTION 'a support role holds % direct database privilege(s) beyond CONNECT', stray_db_grants;
  END IF;

  SELECT count(*) INTO stray_schema_grants
    FROM pg_namespace n
    CROSS JOIN LATERAL aclexplode(n.nspacl) a
    JOIN pg_roles r ON r.oid = a.grantee
   WHERE n.nspname = 'public'
     AND r.rolname IN ('watchdog_support_ro', 'watchdog_support_rw')
     AND a.privilege_type = 'CREATE';
  IF stray_schema_grants <> 0 THEN
    RAISE EXCEPTION 'a support role can create objects in schema public';
  END IF;

  RAISE NOTICE 'support roles verified: ro(login=%, armed_rw=%)', ro.rolcanlogin, rw.rolcanlogin;
END $$;

COMMIT;
