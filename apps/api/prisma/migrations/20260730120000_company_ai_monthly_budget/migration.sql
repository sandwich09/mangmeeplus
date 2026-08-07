-- Phase 4 of the AI metering spec: the per-company monthly cap column, plus §6.8's canonical
-- decision that `modelId` is optional — null means "inherit the platform default model", which
-- `resolveCompanyAiModelPolicy` treats exactly like an absent row. Existing rows keep their
-- model; nothing is rewritten.
-- Idempotent (DROP NOT NULL is a no-op when already nullable; ADD COLUMN IF NOT EXISTS) so a
-- partially-applied deploy re-runs safely — the dirty-tree deploy history makes that a
-- standing requirement.

ALTER TABLE "CompanyAiConfiguration" ALTER COLUMN "modelId" DROP NOT NULL;

-- null = inherit AI_MONTHLY_BUDGET_SATANG. Satang as INTEGER caps at ~฿21M/company/month,
-- orders of magnitude above the ceiling any operator can set.
ALTER TABLE "CompanyAiConfiguration" ADD COLUMN IF NOT EXISTS "monthlyBudgetSatang" INTEGER;
