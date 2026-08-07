-- F1.5.1 items 2+5 — ExecutionAttempt identity/sequence and expired-lease fencing.
--
-- Additive columns + an IN-PLACE reconciliation of EXISTING rows. Every statement is guarded so a
-- re-run (or a partially applied deploy) heals instead of failing, and the reconciliation FAILS
-- CLOSED: if any pre-existing row cannot be rewritten without colliding, the migration raises and
-- rolls back rather than dropping or merging work.

-- 1. `companyScope` — the NOT-NULL mirror of the nullable `companyId`. Every tenant-scoped unique
--    below is keyed on it: Postgres treats NULLs in a unique index as DISTINCT, so a constraint on
--    `companyId` is silently absent for platform-level rows.
ALTER TABLE "ExecutionAttempt" ADD COLUMN IF NOT EXISTS "companyScope" TEXT;
UPDATE "ExecutionAttempt" SET "companyScope" = COALESCE("companyId", '__platform__') WHERE "companyScope" IS NULL;
ALTER TABLE "ExecutionAttempt" ALTER COLUMN "companyScope" SET NOT NULL;

-- The scope is derived, never chosen: pin it so an application bug cannot park a row under another
-- tenant's scope (which would defeat every unique index below).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ExecutionAttempt_companyScope_check') THEN
    ALTER TABLE "ExecutionAttempt"
      ADD CONSTRAINT "ExecutionAttempt_companyScope_check"
      CHECK ("companyScope" = COALESCE("companyId", '__platform__'));
  END IF;
END $$;

-- 2. Lease fencing counter. Bumped on every (re)acquisition of the DISPATCHING lease, so a worker
--    whose expired lease was taken over carries a stale generation and its CAS matches 0 rows.
ALTER TABLE "ExecutionAttempt" ADD COLUMN IF NOT EXISTS "leaseGeneration" INTEGER NOT NULL DEFAULT 0;

-- 3. COMPATIBILITY RECONCILIATION of existing `attemptKey` values.
--    Formats seen in the wild, oldest first:
--      (a) `<callerKey>`                      — pre-P0-5, unscoped
--      (b) `<companyScope>::<callerKey>`      — P0-5 (20260801200000_p0_hardening)
--      (c) `<companyScope>::<attemptSeq>::<callerKey>` — this migration, the target
--    Left alone, an (a)/(b) row is unfindable by the new key builder, so a re-stamp would try to
--    INSERT a second row for the same work and collide on the source identity unique below.
--    `left(x, length(p)) = p` rather than LIKE: the `__platform__` sentinel contains `_`, which is
--    a LIKE wildcard.
DROP TABLE IF EXISTS pg_temp."_attempt_key_target";
CREATE TEMP TABLE "_attempt_key_target" AS
SELECT
  a."id",
  CASE
    WHEN left(a."attemptKey", length(k."np")) = k."np" THEN a."attemptKey"
    WHEN left(a."attemptKey", length(k."p")) = k."p" THEN k."np" || substring(a."attemptKey" FROM length(k."p") + 1)
    ELSE k."np" || a."attemptKey"
  END AS "newKey"
FROM "ExecutionAttempt" a
CROSS JOIN LATERAL (
  SELECT a."companyScope" || '::' AS "p",
         a."companyScope" || '::' || a."attemptSeq"::text || '::' AS "np"
) k;

DO $$
DECLARE collisions TEXT;
BEGIN
  SELECT string_agg("newKey", ', ') INTO collisions
  FROM (SELECT "newKey" FROM "_attempt_key_target" GROUP BY "newKey" HAVING count(*) > 1) d;
  IF collisions IS NOT NULL THEN
    RAISE EXCEPTION 'ExecutionAttempt attemptKey reconciliation is irreconcilable: two rows map to the same scoped key (%). Resolve by hand before deploying.', collisions;
  END IF;

  UPDATE "ExecutionAttempt" a
  SET "attemptKey" = t."newKey"
  FROM "_attempt_key_target" t
  WHERE t."id" = a."id" AND t."newKey" <> a."attemptKey";
END $$;

DROP TABLE IF EXISTS pg_temp."_attempt_key_target";

-- 4. Tenant-scoped source identity, replacing the GLOBAL `(sourceType, sourceId, attemptSeq)`
--    unique that let two companies with colliding business source ids fight over one row.
--    Pre-checked explicitly so an irreconcilable duplicate reports WHICH tuple, instead of surfacing
--    as a bare index-build error.
DO $$
DECLARE collisions TEXT;
BEGIN
  SELECT string_agg(format('%s/%s/%s#%s', "companyScope", "sourceType", "sourceId", "attemptSeq"), ', ') INTO collisions
  FROM (
    SELECT "companyScope", "sourceType", "sourceId", "attemptSeq"
    FROM "ExecutionAttempt" GROUP BY 1, 2, 3, 4 HAVING count(*) > 1
  ) d;
  IF collisions IS NOT NULL THEN
    RAISE EXCEPTION 'ExecutionAttempt has duplicate (companyScope, sourceType, sourceId, attemptSeq) rows: %. Resolve by hand before deploying.', collisions;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "ExecutionAttempt_scope_source_seq_key"
  ON "ExecutionAttempt"("companyScope", "sourceType", "sourceId", "attemptSeq");
DROP INDEX IF EXISTS "ExecutionAttempt_sourceType_sourceId_attemptSeq_key";

-- 5. The P0-5 belt-and-braces index moves onto the NOT-NULL scope column. Its `companyId` form was
--    vacuous for platform rows (NULLs distinct), which is the whole reason `companyScope` exists.
CREATE UNIQUE INDEX IF NOT EXISTS "ExecutionAttempt_companyScope_attemptKey_key"
  ON "ExecutionAttempt"("companyScope", "attemptKey");
DROP INDEX IF EXISTS "ExecutionAttempt_companyId_attemptKey_key";
