-- CRM channel identity verified link marker.
-- Auto-captured webhook provider user ids are not enough for trust-score identity.
ALTER TABLE "CrmChannelIdentity" ADD COLUMN "verifiedLinkAt" TIMESTAMP(3),
ADD COLUMN "verifiedLinkVia" TEXT;

CREATE INDEX "CrmChannelIdentity_customerId_verifiedLinkAt_idx" ON "CrmChannelIdentity"("customerId", "verifiedLinkAt");
