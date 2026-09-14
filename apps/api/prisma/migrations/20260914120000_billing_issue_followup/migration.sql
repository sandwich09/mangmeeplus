ALTER TABLE "BillingIssue"
  ADD COLUMN "backupUserId" TEXT,
  ADD COLUMN "priority" TEXT NOT NULL DEFAULT 'NORMAL',
  ADD COLUMN "followUpAt" TIMESTAMP(3),
  ADD COLUMN "episode" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "BillingIssue" SET "lastSeenAt" = "updatedAt";
CREATE INDEX "BillingIssue_scope_followUpAt_idx" ON "BillingIssue" ("stripeAccountId", "livemode", "state", "followUpAt");
