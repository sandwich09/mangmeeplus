-- A5: reply-send retry bookkeeping on CrmMessage. A PENDING outbound CUSTOMER
-- message whose deliveryNextAttemptAt is due is re-pushed by the reply-retry
-- scanner (429 / 5xx / network only; 401/4xx are terminal FAILED).
ALTER TABLE "CrmMessage" ADD COLUMN "deliveryAttemptCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CrmMessage" ADD COLUMN "deliveryNextAttemptAt" TIMESTAMP(3);

-- Sweep index for the reply-retry + media/pending scan.
CREATE INDEX "CrmMessage_deliveryStatus_deliveryNextAttemptAt_idx" ON "CrmMessage"("deliveryStatus", "deliveryNextAttemptAt");
