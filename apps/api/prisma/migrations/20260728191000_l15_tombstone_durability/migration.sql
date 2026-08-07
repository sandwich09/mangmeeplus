-- L-15: the PDPA erasure tombstone must outlive the record it exists to outlive.
-- 20260728150000_p1_pdpa_durable_cases created "CrmDataSubjectRequest" with an
-- ON DELETE CASCADE foreign key to "CrmCustomer", so a hard delete of the subject
-- would take the proof of erasure with it. Recreate the constraint as RESTRICT.
--
-- No live behavior changes: erasure anonymizes and there is no hard-delete path
-- today. This removes the future footgun.
--
-- Defensive and idempotent by design: the 20260728150000 migration is untracked
-- in the working tree and may still change, so this is a clean no-op when the
-- table or the constraint is absent, and safe to run more than once.
DO $$
BEGIN
  IF to_regclass('"CrmDataSubjectRequest"') IS NULL THEN
    RETURN;
  END IF;

  -- confdeltype: 'c' = CASCADE, 'r' = RESTRICT, 'a' = NO ACTION.
  -- Drop only when the constraint exists and is not already RESTRICT.
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = '"CrmDataSubjectRequest"'::regclass
      AND conname = 'CrmDataSubjectRequest_companyId_customerId_fkey'
      AND contype = 'f'
      AND confdeltype <> 'r'
  ) THEN
    ALTER TABLE "CrmDataSubjectRequest"
      DROP CONSTRAINT "CrmDataSubjectRequest_companyId_customerId_fkey";
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = '"CrmDataSubjectRequest"'::regclass
      AND conname = 'CrmDataSubjectRequest_companyId_customerId_fkey'
      AND contype = 'f'
  ) THEN
    ALTER TABLE "CrmDataSubjectRequest"
      ADD CONSTRAINT "CrmDataSubjectRequest_companyId_customerId_fkey"
      FOREIGN KEY ("companyId", "customerId")
      REFERENCES "CrmCustomer"("companyId", "id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$$;
