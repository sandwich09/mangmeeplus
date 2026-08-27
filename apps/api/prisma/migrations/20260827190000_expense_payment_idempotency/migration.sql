-- Legacy payments remain unkeyed. New intent identity is company-scoped and atomic.
ALTER TABLE "ExpensePayment"
  ADD COLUMN "idempotencyKey" TEXT,
  ADD COLUMN "payloadFingerprint" TEXT,
  ADD CONSTRAINT "ExpensePayment_intent_pair_check" CHECK (
    ("idempotencyKey" IS NULL AND "payloadFingerprint" IS NULL)
    OR ("idempotencyKey" IS NOT NULL AND "payloadFingerprint" IS NOT NULL
        AND "payloadFingerprint" ~ '^[a-f0-9]{64}$')
  );

CREATE UNIQUE INDEX "ExpensePayment_companyId_idempotencyKey_key"
  ON "ExpensePayment"("companyId", "idempotencyKey");
