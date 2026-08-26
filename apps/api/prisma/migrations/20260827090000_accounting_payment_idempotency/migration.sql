-- Allocated receipts are at-most-once commands; legacy and bundle-created payments remain nullable.
ALTER TABLE "AccountingPayment"
  ADD COLUMN "idempotencyKey" TEXT,
  ADD COLUMN "payloadFingerprint" TEXT;

CREATE UNIQUE INDEX "AccountingPayment_companyId_idempotencyKey_key"
  ON "AccountingPayment"("companyId", "idempotencyKey");
