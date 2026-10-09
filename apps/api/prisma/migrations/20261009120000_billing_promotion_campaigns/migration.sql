-- Promotion campaigns (docs/plans/starter-249-bonus-month-promotion-plan.md §3; spec
-- docs/specs/starter-249-bonus-month-promotion-spec-th.md §6). Additive only: two nullable columns, one more
-- lot kind the grant check allows, and the redemption table. No backfill; nothing changes for a purchase
-- without a promotion. States are TEXT + CHECK, not enums. Prisma cannot model the CHECKs, so schema.prisma
-- names them in comments — do NOT let a future `prisma migrate diff` drop them.

-- Campaign terms beside the policy (plan R1): a binary that does not know campaigns still parses `policyJson`.
ALTER TABLE "BillingPolicyRevision" ADD COLUMN "promotionJson" JSONB;

-- Service end including the free time (plan R2); NULL = "periodEnd". The financial period is never stretched.
ALTER TABLE "BillingInvoice" ADD COLUMN "benefitEnd" TIMESTAMP(3);

-- The bonus lot (spec §5). The check is replaced by a wider one exactly as 20260929150000 did: every existing
-- row satisfies it unchanged. A bonus lot has at least one unit and a fixed expiry at the end of its free time.
ALTER TABLE "BillingReceiptGrant"
  DROP CONSTRAINT "BillingReceiptGrant_valid_units_period_kind",
  ADD CONSTRAINT "BillingReceiptGrant_valid_units_period_kind" CHECK (
    "units" >= 0 AND "serviceStart" < "serviceEnd" AND "availableAt" < "expiresAt" AND "expiresAt" >= "serviceEnd"
    AND "kind" IN ('INITIAL', 'RENEWAL', 'REPEAT', 'UPGRADE', 'ADMIN_ADJUSTMENT', 'TRIAL_CARRYOVER', 'ADD_ON_PAID', 'ADD_ON_ADMIN', 'SALES_EVENT', 'PROMOTION')
    AND ("kind" <> 'ADMIN_ADJUSTMENT' OR "units" > 0)
    AND ("kind" <> 'TRIAL_CARRYOVER' OR ("units" BETWEEN 1 AND 15 AND "expiresAt" = "serviceEnd"))
    AND ("kind" NOT IN ('ADD_ON_PAID', 'ADD_ON_ADMIN', 'SALES_EVENT') OR "units" > 0)
    AND ("kind" <> 'PROMOTION' OR ("units" > 0 AND "expiresAt" = "serviceEnd"))
  );

-- CreateTable
CREATE TABLE "BillingPromotionRedemption" (
    "id" TEXT NOT NULL,
    "promotionEnvironmentId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "billingAccountId" TEXT NOT NULL,
    "stripeAccountId" TEXT NOT NULL,
    "livemode" BOOLEAN NOT NULL,
    "state" TEXT NOT NULL,
    "policyRevisionId" TEXT NOT NULL,
    "campaignRevision" INTEGER NOT NULL,
    "termsHash" TEXT NOT NULL,
    "offerKey" TEXT NOT NULL,
    "interval" TEXT NOT NULL,
    "offerSignature" TEXT NOT NULL,
    "bonusMonths" INTEGER NOT NULL,
    "bonusReceiptUnits" INTEGER NOT NULL,
    "attemptId" TEXT,
    "invoiceId" TEXT,
    "acceptedAt" TIMESTAMP(3) NOT NULL,
    "createBy" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "benefitAppliedAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "entitlementAdjustedAt" TIMESTAMP(3),
    "paidStart" TIMESTAMP(3),
    "paidEnd" TIMESTAMP(3),
    "bonusEnd" TIMESTAMP(3),
    "releaseCount" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingPromotionRedemption_pkey" PRIMARY KEY ("id"),
    -- TEST and LIVE are separate namespaces; the provider account is only a binding (plan R12).
    CONSTRAINT "BillingPromotionRedemption_environment_check" CHECK (
      "promotionEnvironmentId" IN ('LIVE', 'TEST') AND "livemode" = ("promotionEnvironmentId" = 'LIVE')
    ),
    -- Spec §6: a reservation is always held by one Checkout attempt; a used right names its paid invoice and
    -- is never released; a released right holds no attempt, so a stale callback cannot use or release it.
    CONSTRAINT "BillingPromotionRedemption_state_check" CHECK (
      ("state" = 'RESERVED' AND "attemptId" IS NOT NULL AND "invoiceId" IS NULL)
      OR ("state" = 'CONSUMED' AND "invoiceId" IS NOT NULL AND "consumedAt" IS NOT NULL)
      OR ("state" = 'RELEASED' AND "attemptId" IS NULL AND "invoiceId" IS NULL AND "releasedAt" IS NOT NULL)
    )
);

-- CreateIndex
CREATE UNIQUE INDEX "BillingPromotionRedemption_attemptId_key" ON "BillingPromotionRedemption"("attemptId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingPromotionRedemption_invoiceId_key" ON "BillingPromotionRedemption"("invoiceId");

-- CreateIndex
CREATE INDEX "BillingPromotionRedemption_promotionEnvironmentId_campaignI_idx" ON "BillingPromotionRedemption"("promotionEnvironmentId", "campaignId", "state");

-- CreateIndex
CREATE INDEX "BillingPromotionRedemption_companyId_idx" ON "BillingPromotionRedemption"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingPromotionRedemption_promotionEnvironmentId_campaignI_key" ON "BillingPromotionRedemption"("promotionEnvironmentId", "campaignId", "companyId");
