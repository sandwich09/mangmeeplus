-- PDPA tenant tripwire (M-05 register §6): the declared business category is what lets a
-- health-adjacent tenant (clinic, wellness/spa, medical retail) alert the dev team at
-- onboarding instead of silently invalidating the deferred s.41 limb (b) assumption.
-- Nullable, no default: companies onboarded before the tripwire stay uncategorised rather
-- than being asserted into a category nobody declared.
-- Idempotent (enum guard + ADD COLUMN IF NOT EXISTS) so a partially-applied deploy re-runs safely.
DO $$
BEGIN
  CREATE TYPE "CompanyBusinessCategory" AS ENUM ('RETAIL', 'TRADING', 'SERVICE', 'CLINIC', 'WELLNESS_SPA', 'MEDICAL_RETAIL', 'OTHER');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "businessCategory" "CompanyBusinessCategory";
