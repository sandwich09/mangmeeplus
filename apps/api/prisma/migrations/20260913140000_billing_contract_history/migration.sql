ALTER TABLE "BillingInvoice" ADD COLUMN "contractSnapshot" JSONB;

CREATE TABLE "BillingSubscriptionContract" (
  "id" TEXT NOT NULL,
  "billingAccountId" TEXT NOT NULL,
  "sourceAttemptId" TEXT NOT NULL,
  "effectiveAt" TIMESTAMP(3) NOT NULL,
  "snapshotJson" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BillingSubscriptionContract_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BillingSubscriptionContract_billingAccountId_fkey" FOREIGN KEY ("billingAccountId") REFERENCES "BillingAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "BillingSubscriptionContract_billingAccountId_sourceAttemptId_key" ON "BillingSubscriptionContract"("billingAccountId", "sourceAttemptId");
CREATE INDEX "BillingSubscriptionContract_billingAccountId_effectiveAt_idx" ON "BillingSubscriptionContract"("billingAccountId", "effectiveAt");
