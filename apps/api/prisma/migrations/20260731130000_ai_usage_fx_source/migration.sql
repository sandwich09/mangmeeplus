-- Owner addendum to phase 6 (spec §6.4 addendum, criterion 15): every usage row records WHERE
-- its rate came from, so env-fallback-priced rows are findable by query rather than only by a
-- log line that has since rotated.
-- Idempotent (IF NOT EXISTS + a NULL-only backfill + an already-a-no-op SET NOT NULL) so a
-- partially-applied deploy re-runs safely — the dirty-tree deploy history makes that standing.

-- Added nullable first so existing rows survive, then backfilled with 'env-fallback': every row
-- written before the FX module existed was priced straight from the AI_THB_PER_USD config value,
-- which is exactly what that source means — a factual backfill, not a guess.
ALTER TABLE "AiUsageEvent" ADD COLUMN IF NOT EXISTS "thbPerUsdSource" TEXT;
UPDATE "AiUsageEvent" SET "thbPerUsdSource" = 'env-fallback' WHERE "thbPerUsdSource" IS NULL;
-- SET NOT NULL is itself a no-op when the column is already NOT NULL, so the re-run is clean.
ALTER TABLE "AiUsageEvent" ALTER COLUMN "thbPerUsdSource" SET NOT NULL;
