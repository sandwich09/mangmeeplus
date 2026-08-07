-- มั่งมี Flow A (spec D10): customer tier + engagement score.
-- Drives broadcast segments (Track B Phase B4) and discount-policy tiers (Phase B3).
-- CreateEnum
CREATE TYPE "CrmCustomerTier" AS ENUM ('VIP', 'ACTIVE', 'LEAD');

ALTER TABLE "CrmCustomer"
  ADD COLUMN "tier" "CrmCustomerTier" NOT NULL DEFAULT 'LEAD',
  ADD COLUMN "engagementScore" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "CrmCustomer_companyId_tier_idx" ON "CrmCustomer"("companyId", "tier");
