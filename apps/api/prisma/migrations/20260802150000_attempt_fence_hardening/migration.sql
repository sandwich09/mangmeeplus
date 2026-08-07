-- F1.5.2 blocker 3 — ExecutionAttempt fence hardening.
--
-- ADDITIVE ONLY. Two nullable columns and one enum value; no existing row is rewritten and no
-- constraint is tightened, so a rollback to the previous build keeps reading and writing this table.
-- Every statement is idempotent, so a re-run (or a partially applied deploy) heals instead of
-- failing.

-- 1. Deployment identity of the vector (blocker 2, service side). `claimAttempt` /
--    `acquireDispatchLease` require the attempt's environment to equal the RUNNING deployment's,
--    and the stamped route generation to carry an OPEN attestation for the attempt's build — the
--    same rule `launch-gate.guard.ts` applies to inbound requests. NULL = stamped before this
--    column existed: unprovable, therefore treated as CLOSED rather than waved through.
ALTER TABLE "ExecutionAttempt" ADD COLUMN IF NOT EXISTS "targetEnvironment" TEXT;
ALTER TABLE "ExecutionAttempt" ADD COLUMN IF NOT EXISTS "buildReleaseId" TEXT;

-- 2. The definitive-failure terminal, distinct from UNKNOWN_EXTERNAL_OUTCOME.
--    UNKNOWN = the provider may have received the work, so nothing may retry until it is
--    reconciled. FAILED_CONFIRMED = the provider answered with a definitive failure, so nothing was
--    effected and Resume/Reissue at the next attemptSeq is allowed.
--    `ADD VALUE` is not usable inside the transaction that adds it; nothing here writes the value.
ALTER TYPE "ExecutionAttemptStatus" ADD VALUE IF NOT EXISTS 'FAILED_CONFIRMED' AFTER 'UNKNOWN_EXTERNAL_OUTCOME';
