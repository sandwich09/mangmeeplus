-- GAP-02 (Lane B, path B): reimbursement claims materialize into ExpenseRecord.
-- This backlink lets the posting engine route the payable credit to the employee
-- payable account (2130-01) instead of trade AP (2120-01).
--
-- Every statement is re-runnable: prod deploys ship a dirty tree, so a migration
-- can be recorded-applied from an unfinished file (docs/agent-memory prod migration drift).

ALTER TABLE "ExpenseRecord" ADD COLUMN IF NOT EXISTS "sourceReimbursementRequestId" TEXT;

CREATE INDEX IF NOT EXISTS "ExpenseRecord_companyId_sourceReimbursementRequestId_idx"
  ON "ExpenseRecord"("companyId", "sourceReimbursementRequestId");
