ALTER TABLE "BillingOperation" ADD COLUMN "scheduledFor" TIMESTAMP(3);
CREATE INDEX "BillingOperation_schedule_idx"
  ON "BillingOperation"("stripeAccountId", "livemode", "state", "scheduledFor");
