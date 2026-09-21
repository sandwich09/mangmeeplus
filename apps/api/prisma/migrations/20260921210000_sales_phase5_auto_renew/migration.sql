-- Phase 5 "auto-renewing special deals" (spec §17.3/D7, §19.2, §19.5 Q8, §18 Q1, §19.9 D-P5-1…8).
-- Additive only: four nullable columns on the deal row and their two sweep indexes. The v3 offer
-- snapshot lives in the existing `offerSnapshotJson`, so no stored JSON is rewritten and every
-- Phase 3/4 row keeps its exact meaning (it reads back as `autoRenew: false`).

-- D-P5-3: the shop's own recurring Stripe Price, created when the lead approves the deal.
-- `priceState` is the gate: only 'READY' may be quoted; 'PENDING'/'FAILED' are retried by the
-- 15-minute sales sweep, so a Stripe blip at approval time delays an offer instead of losing it.
ALTER TABLE "PackageChangeRequest" ADD COLUMN "stripePriceId" TEXT;
ALTER TABLE "PackageChangeRequest" ADD COLUMN "stripePriceCreatedAt" TIMESTAMP(3);
ALTER TABLE "PackageChangeRequest" ADD COLUMN "priceState" TEXT;

-- D-P5-6: when this shop goes back to its base tier's catalog price (Q1 resets menus, AI credit
-- and limits in the same apply). Written after the first cycle for an N-cycle deal, or when a
-- lead ends an until-revoked one.
ALTER TABLE "PackageChangeRequest" ADD COLUMN "returnAt" TIMESTAMP(3);

CREATE INDEX "PackageChangeRequest_kind_priceState_idx" ON "PackageChangeRequest"("kind", "priceState");
CREATE INDEX "PackageChangeRequest_returnAt_idx" ON "PackageChangeRequest"("returnAt");
