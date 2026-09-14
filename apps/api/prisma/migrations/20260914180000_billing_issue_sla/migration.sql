-- Existing cases retain their explicit follow-up and have no inferred SLA clock.
ALTER TABLE "BillingIssue"
  ADD COLUMN "slaStartedAt" TIMESTAMP(3),
  ADD COLUMN "slaDueAt" TIMESTAMP(3),
  ADD COLUMN "slaPolicyRevisionId" TEXT;
CREATE INDEX "BillingIssue_scope_slaDueAt_idx"
  ON "BillingIssue"("stripeAccountId", "livemode", "state", "slaDueAt");
