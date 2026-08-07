-- F1.5b P0 hardening. Additive only: two nullable columns and one unique index.
-- `IF NOT EXISTS` everywhere so a re-run (or a partially applied deploy) heals instead of failing.

-- P0-4: fenced outbox completion. `claimBatch` mints one random token per claimed row and
-- `markPublished`/`markFailed` CAS on {id, PROCESSING, claimToken}, so a resurrected dead worker
-- carrying a stale token can no longer overwrite the row a newer claimer owns. The reclaim clears
-- the token when it returns a row to PENDING, which is what invalidates the old claimer's lease.
ALTER TABLE "OutboxEvent" ADD COLUMN IF NOT EXISTS "claimToken" TEXT;

-- P0-5: tenant-safe execution-attempt identity. `attemptKey` is now stored SCOPED
-- (`<companyId|__platform__>::<callerKey>`) so one caller key can never resolve to another
-- company's attempt, and `identityFingerprint` pins the immutable source identity that the
-- upsert compares on a hit. Nullable: pre-existing rows keep NULL and are compared on companyId
-- alone (spec:63 forbids back-stamping old work).
ALTER TABLE "ExecutionAttempt" ADD COLUMN IF NOT EXISTS "identityFingerprint" TEXT;

-- The tenant-scoped uniqueness the owner review requires. It is deliberately BELT-AND-BRACES:
-- `attemptKey` stays globally unique on the scoped value (Prisma cannot address a compound unique
-- whose column is NULL, and Postgres treats NULLs as distinct, so platform rows are scoped by the
-- sentinel inside the key instead).
CREATE UNIQUE INDEX IF NOT EXISTS "ExecutionAttempt_companyId_attemptKey_key"
  ON "ExecutionAttempt"("companyId", "attemptKey");
