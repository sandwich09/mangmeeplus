-- Phase 4 "renewal offers, attribution reports, subscription conversion"
-- (docs/specs/mangmee-sales-deals-and-locked-signup-spec-th.md §17.1/§17.2, §19.3, §19.5 Q7).
-- Additive only: new nullable columns and their indexes. Nothing is dropped or rewritten, so the
-- Phase 3 rows already in the table keep their exact meaning.

-- ── Renewal offers (D3) on the deal row ──────────────────────────────────────────────
-- `renewalOfRequestId` is the sweep's idempotency key: one renewal per APPLIED deal, ever.
ALTER TABLE "PackageChangeRequest" ADD COLUMN "renewalOfRequestId" TEXT;
ALTER TABLE "PackageChangeRequest" ADD COLUMN "renewalRemindedAt" TIMESTAMP(3);
CREATE INDEX "PackageChangeRequest_renewalOfRequestId_idx" ON "PackageChangeRequest"("renewalOfRequestId");

-- ── Attribution: anti-gaming flags live on the row (§17.1) ───────────────────────────
ALTER TABLE "SalesAttribution" ADD COLUMN "flags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "SalesAttribution" ADD COLUMN "flaggedAt" TIMESTAMP(3);
ALTER TABLE "SalesAttribution" ADD COLUMN "flagReviewedAt" TIMESTAMP(3);
ALTER TABLE "SalesAttribution" ADD COLUMN "flagReviewedByUserId" TEXT;
ALTER TABLE "SalesAttribution" ADD COLUMN "flagReviewNote" TEXT;
CREATE INDEX "SalesAttribution_flaggedAt_idx" ON "SalesAttribution"("flaggedAt");
