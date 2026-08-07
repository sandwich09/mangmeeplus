-- UAT r7 gap — the DURABLE cohort of a normalization marker (`LEGACY` | `EXPLICIT`).
--
-- Verify used to infer "this is a grandfathered company" from `rows.some(grantOrigin = 'LEGACY')`,
-- so a legacy company whose provenance stamp landed on ZERO rows read as "not grandfathered" and
-- passed with its entire cohort marker missing. The cohort is now recorded on the marker itself.
--
-- Additive and idempotent, with NO backfill on purpose: the same release raises NORMALIZER_VERSION
-- to 1, which re-opens every existing marker (all at version 0) and rewrites it with a real cohort.
-- Guessing a value here would manufacture exactly the unverified claim this column exists to stop.
ALTER TABLE "CompanyEntitlementNormalization"
  ADD COLUMN IF NOT EXISTS "cohortKind" TEXT;
