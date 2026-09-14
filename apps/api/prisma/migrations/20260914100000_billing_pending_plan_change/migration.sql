ALTER TABLE "BillingAccount" ADD COLUMN "pendingPlanChangeId" TEXT;
CREATE UNIQUE INDEX "BillingAccount_pendingPlanChangeId_key" ON "BillingAccount"("pendingPlanChangeId");
-- Deterministic consent ordering, including replacements at the same service boundary.
CREATE SEQUENCE "BillingSubscriptionContract_revision_seq";
ALTER TABLE "BillingSubscriptionContract" ADD COLUMN "revision" INTEGER;
WITH ordered AS (SELECT "id", row_number() OVER (ORDER BY "createdAt", "id") AS n FROM "BillingSubscriptionContract")
UPDATE "BillingSubscriptionContract" c SET "revision" = ordered.n FROM ordered WHERE c."id" = ordered."id";
SELECT setval('"BillingSubscriptionContract_revision_seq"', COALESCE(MAX("revision"), 1), MAX("revision") IS NOT NULL) FROM "BillingSubscriptionContract";
ALTER TABLE "BillingSubscriptionContract" ALTER COLUMN "revision" SET NOT NULL,
  ALTER COLUMN "revision" SET DEFAULT nextval('"BillingSubscriptionContract_revision_seq"');
ALTER SEQUENCE "BillingSubscriptionContract_revision_seq" OWNED BY "BillingSubscriptionContract"."revision";
CREATE UNIQUE INDEX "BillingSubscriptionContract_revision_key" ON "BillingSubscriptionContract"("revision");
