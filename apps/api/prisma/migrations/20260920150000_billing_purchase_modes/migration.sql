ALTER TABLE "BillingAccount"
  ADD COLUMN "renewalMode" TEXT NOT NULL DEFAULT 'NONE',
  ADD COLUMN "billingAnchorDay" INTEGER;

UPDATE "BillingAccount"
SET "renewalMode" = 'CARD_AUTO'
WHERE "baseSubscriptionId" IS NOT NULL
  AND "paidThrough" IS NOT NULL;
