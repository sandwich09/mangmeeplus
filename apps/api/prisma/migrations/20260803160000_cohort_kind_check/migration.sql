-- UAT r8 A3 — `cohortKind` is a closed set, enforced by the database.
--
-- The column is a plain `String?` (Prisma cannot express a CHECK, so this is raw SQL and
-- schema.prisma is deliberately untouched). Every reader used to treat "not LEGACY" as EXPLICIT,
-- and EXPLICIT is the cohort that waives the grandfather provenance check entirely — so a typo, a
-- hand-run UPDATE during a heal, or a future value would silently downgrade a grandfathered company
-- to "no stamp required" and let the day-14 removal of legacy semantics drop access.
--
-- Additive and idempotent. NULL stays legal on purpose: it is the recorded absence of evidence,
-- which `verifyCompanyNormalizations` reports as INCOMPLETE rather than guessing about.
-- Safe against existing data — the only values any writer has ever produced are 'LEGACY',
-- 'EXPLICIT' and NULL (normalize-entitlements.ts and create-company-onboarding.use-case.ts are the
-- only two writers), and the constraint is added NOT VALID-free precisely so a violating row would
-- fail the migration loudly instead of being carried forward unnoticed.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = '"CompanyEntitlementNormalization"'::regclass
       AND conname = 'CompanyEntitlementNormalization_cohortKind_check'
  ) THEN
    ALTER TABLE "CompanyEntitlementNormalization"
      ADD CONSTRAINT "CompanyEntitlementNormalization_cohortKind_check"
      CHECK ("cohortKind" IS NULL OR "cohortKind" IN ('LEGACY', 'EXPLICIT'));
  END IF;
END $$;
