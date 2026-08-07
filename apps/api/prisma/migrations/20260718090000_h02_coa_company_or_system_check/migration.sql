-- H-02: a chart-of-account row must belong to a company unless it is an explicit
-- system account. Prevents nullable-global ambiguity where a tenant row with
-- companyId NULL + isSystem false would leak into every tenant's global lookup
-- (listAccounts / findAccountByCode OR-clauses match companyId NULL only with
-- isSystem = true, but the DB must enforce the invariant too).
-- Idempotent: safe to re-run (drop-if-exists then add).
--
-- Fail-closed by design: a row violating the invariant cannot be auto-healed
-- (its tenant is unknowable; flipping isSystem would globalize it). The block
-- below turns the opaque 23514 into an actionable triage message; deploy is
-- blocked until the rows are dispositioned by hand.
DO $$
DECLARE bad integer;
BEGIN
  SELECT count(*) INTO bad FROM "ChartOfAccount" WHERE "companyId" IS NULL AND "isSystem" = false;
  IF bad > 0 THEN
    RAISE EXCEPTION 'H-02 pre-check: % ChartOfAccount row(s) have companyId NULL with isSystem false. Triage them (assign the right companyId, or mark verified global accounts isSystem=true) before this migration can apply. List: SELECT id, code, "nameTh" FROM "ChartOfAccount" WHERE "companyId" IS NULL AND "isSystem" = false;', bad;
  END IF;
END $$;

ALTER TABLE "ChartOfAccount" DROP CONSTRAINT IF EXISTS "ChartOfAccount_company_or_system_check";
ALTER TABLE "ChartOfAccount" ADD CONSTRAINT "ChartOfAccount_company_or_system_check"
  CHECK ("companyId" IS NOT NULL OR "isSystem" = true);
